import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyType } from '../../common/enums/company-type.enum';
import { Company } from '../../entities/company.entity';
import { QuickbooksApiService } from './quickbooks-api.service';
import {
  QboVendorSummary,
  QuickbooksNormalizerService,
} from './quickbooks-normalizer.service';

const MATCHABLE_COMPANY_TYPES = [
  CompanyType.SUPPLIER,
  CompanyType.SUBCONTRACTOR,
];
const DEFAULT_MIN_CONFIDENCE = 0.7;
const CONFIRMED_CONFIDENCE = 0.85;

export type QboVendorMatchMethod =
  | 'stored'
  | 'email'
  | 'phone'
  | 'exact_name'
  | 'fuzzy_name'
  | 'none';

export type QboVendorMatchStatus =
  | 'confirmed'
  | 'suggested'
  | 'low_confidence'
  | 'manual_match_protected'
  | 'unmatched';

export interface QboVendorMatchingOptions {
  companyId?: number;
  minConfidence?: number;
  includeLowConfidence?: boolean;
  maxCandidates?: number;
}

export interface CrmVendorCompanySummary {
  id: number;
  name: string;
  type?: CompanyType;
  email?: string;
  phone?: string;
  qboVendorId?: string;
  qboVendorName?: string;
  qboVendorMatchConfidence?: number;
  qboVendorMatchedAt?: Date;
  qboVendorLastSyncedAt?: Date;
}

export interface QboVendorMatchCandidate {
  vendorId: string;
  vendorName: string;
  email?: string;
  phone?: string;
  confidence: number;
  method: QboVendorMatchMethod;
  status: QboVendorMatchStatus;
  confirmed: boolean;
  reasons: string[];
}

export interface ExistingQboVendorMatch {
  vendorId: string;
  vendorName?: string;
  matchConfidence?: number;
  matchedAt?: Date;
  lastSyncedAt?: Date;
  vendorFoundInQbo: boolean;
}

export interface QboVendorCompanyMatch {
  company: CrmVendorCompanySummary;
  existingQboVendor?: ExistingQboVendorMatch;
  bestMatch?: QboVendorMatchCandidate;
  candidates: QboVendorMatchCandidate[];
  status: QboVendorMatchStatus;
  protectedExistingMatch: boolean;
}

export interface QboVendorMatchingResult {
  realmId: string;
  generatedAt: string;
  vendorsChecked: number;
  companiesChecked: number;
  minConfidence: number;
  matches: QboVendorCompanyMatch[];
  totals: Record<QboVendorMatchStatus, number>;
}

export interface QboVendorCrmMapEntry {
  vendorId: string;
  vendorName: string;
  vendorEmail?: string;
  vendorPhone?: string;
  crmCompanyId?: number;
  crmCompanyName?: string;
  crmType?: CompanyType;
  matchConfidence?: number;
  matchMethod?: QboVendorMatchMethod;
  matchStatus: QboVendorMatchStatus;
}

export interface QboVendorCrmMapResult {
  realmId: string;
  generatedAt: string;
  entries: QboVendorCrmMapEntry[];
  byVendorId: Record<string, QboVendorCrmMapEntry>;
}

interface NormalizedOptions {
  companyId?: number;
  minConfidence: number;
  includeLowConfidence: boolean;
  maxCandidates: number;
}

interface MatchEvaluation {
  confidence: number;
  method: QboVendorMatchMethod;
  reasons: string[];
}

@Injectable()
export class QuickbooksVendorMatchingService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
  ) {}

  async listQboVendors(realmId: string): Promise<QboVendorSummary[]> {
    const vendors = await this.apiService.queryAll(realmId, 'Vendor');
    return vendors
      .map((vendor) => this.normalizer.normalizeVendor(this.asRecord(vendor)))
      .filter((vendor) => vendor.vendorId || vendor.displayName)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async matchCrmCompaniesToVendors(
    realmId: string,
    options: QboVendorMatchingOptions = {},
  ): Promise<QboVendorMatchingResult> {
    const normalizedOptions = this.normalizeOptions(options);
    const [vendors, companies] = await Promise.all([
      this.listQboVendors(realmId),
      this.loadCompanies(normalizedOptions.companyId),
    ]);
    const matches = this.buildCompanyMatches(
      vendors,
      companies,
      normalizedOptions,
    );

    return {
      realmId,
      generatedAt: new Date().toISOString(),
      vendorsChecked: vendors.length,
      companiesChecked: companies.length,
      minConfidence: normalizedOptions.minConfidence,
      matches,
      totals: this.countStatuses(matches),
    };
  }

  async suggestVendorMatches(
    realmId: string,
    companyId?: number,
  ): Promise<QboVendorMatchingResult> {
    return this.matchCrmCompaniesToVendors(realmId, {
      companyId,
      includeLowConfidence: true,
      maxCandidates: 5,
      minConfidence: 0.5,
    });
  }

  async getVendorCrmMap(realmId: string): Promise<QboVendorCrmMapResult> {
    const options = this.normalizeOptions({
      minConfidence: DEFAULT_MIN_CONFIDENCE,
      includeLowConfidence: false,
      maxCandidates: 1,
    });
    const [vendors, companies] = await Promise.all([
      this.listQboVendors(realmId),
      this.loadCompanies(),
    ]);
    const matches = this.buildCompanyMatches(vendors, companies, options);
    const bestByVendorId = new Map<
      string,
      { match: QboVendorCompanyMatch; candidate: QboVendorMatchCandidate }
    >();

    for (const match of matches) {
      const candidate = match.bestMatch;
      if (!candidate || candidate.confidence < options.minConfidence) continue;
      if (
        candidate.status !== 'confirmed' &&
        candidate.status !== 'suggested'
      ) {
        continue;
      }

      const current = bestByVendorId.get(candidate.vendorId);
      if (this.isBetterVendorMapCandidate(match, candidate, current)) {
        bestByVendorId.set(candidate.vendorId, { match, candidate });
      }
    }

    const entries = vendors.map((vendor) =>
      this.toVendorCrmMapEntry(vendor, bestByVendorId.get(vendor.vendorId)),
    );
    const byVendorId = entries.reduce<Record<string, QboVendorCrmMapEntry>>(
      (acc, entry) => {
        if (entry.vendorId) acc[entry.vendorId] = entry;
        return acc;
      },
      {},
    );

    return {
      realmId,
      generatedAt: new Date().toISOString(),
      entries,
      byVendorId,
    };
  }

  private async loadCompanies(companyId?: number): Promise<Company[]> {
    if (companyId !== undefined) {
      const company = await this.companyRepo.findOne({ where: { id: companyId } });
      if (!company) {
        throw new NotFoundException(`Company not found with id: ${companyId}`);
      }
      return [company];
    }

    return this.companyRepo.find({
      where: MATCHABLE_COMPANY_TYPES.map((type) => ({ type })),
      order: { name: 'ASC' },
    });
  }

  private buildCompanyMatches(
    vendors: QboVendorSummary[],
    companies: Company[],
    options: NormalizedOptions,
  ): QboVendorCompanyMatch[] {
    const vendorsById = new Map(vendors.map((vendor) => [vendor.vendorId, vendor]));

    return companies.map((companyEntity) => {
      const company = this.toCompanySummary(companyEntity);
      const existingQboVendor = this.toExistingMatch(company, vendorsById);
      const storedCandidate = this.toStoredCandidate(company, vendorsById);
      const scoredCandidates = vendors
        .map((vendor) => this.scoreCandidate(company, vendor))
        .filter((candidate) => candidate.confidence > 0)
        .sort((a, b) => this.compareCandidates(a, b));

      const candidates = scoredCandidates
        .filter(
          (candidate) =>
            options.includeLowConfidence ||
            candidate.confidence >= options.minConfidence,
        )
        .slice(0, options.maxCandidates);

      let bestMatch: QboVendorMatchCandidate | undefined =
        storedCandidate ?? candidates[0];
      let protectedExistingMatch = false;

      if (
        company.qboVendorId &&
        bestMatch &&
        bestMatch.vendorId !== company.qboVendorId &&
        bestMatch.confidence < CONFIRMED_CONFIDENCE
      ) {
        protectedExistingMatch = true;
        bestMatch = undefined;
      }

      const status = protectedExistingMatch
        ? 'manual_match_protected'
        : bestMatch?.status ?? 'unmatched';

      return {
        company,
        ...(existingQboVendor && { existingQboVendor }),
        ...(bestMatch && { bestMatch }),
        candidates,
        status,
        protectedExistingMatch,
      };
    });
  }

  private scoreCandidate(
    company: CrmVendorCompanySummary,
    vendor: QboVendorSummary,
  ): QboVendorMatchCandidate {
    const evaluations = [
      this.evaluateEmail(company, vendor),
      this.evaluatePhone(company, vendor),
      this.evaluateName(company, vendor),
    ].filter((evaluation): evaluation is MatchEvaluation => evaluation !== null);

    const best =
      evaluations.sort((a, b) => b.confidence - a.confidence)[0] ??
      ({
        confidence: 0,
        method: 'none',
        reasons: [],
      } satisfies MatchEvaluation);
    const bonus = evaluations.length > 1 && best.confidence > 0 ? 0.02 : 0;
    const confidence = this.roundConfidence(
      Math.min(1, best.confidence + bonus),
    );
    const status = this.statusForConfidence(confidence);

    return {
      vendorId: vendor.vendorId,
      vendorName: vendor.displayName,
      ...(vendor.email && { email: vendor.email }),
      ...(vendor.phone && { phone: vendor.phone }),
      confidence,
      method: best.method,
      status,
      confirmed: status === 'confirmed',
      reasons: [...new Set(evaluations.flatMap((item) => item.reasons))],
    };
  }

  private evaluateEmail(
    company: CrmVendorCompanySummary,
    vendor: QboVendorSummary,
  ): MatchEvaluation | null {
    const companyEmail = this.normalizeEmail(company.email);
    const vendorEmail = this.normalizeEmail(vendor.email);
    if (!companyEmail || !vendorEmail || companyEmail !== vendorEmail) {
      return null;
    }
    return {
      confidence: 0.98,
      method: 'email',
      reasons: ['email_exact_match'],
    };
  }

  private evaluatePhone(
    company: CrmVendorCompanySummary,
    vendor: QboVendorSummary,
  ): MatchEvaluation | null {
    const companyPhone = this.normalizePhone(company.phone);
    const vendorPhone = this.normalizePhone(vendor.phone);
    if (
      companyPhone.length < 7 ||
      vendorPhone.length < 7 ||
      !this.phoneMatches(companyPhone, vendorPhone)
    ) {
      return null;
    }
    return {
      confidence: 0.92,
      method: 'phone',
      reasons: ['phone_match'],
    };
  }

  private evaluateName(
    company: CrmVendorCompanySummary,
    vendor: QboVendorSummary,
  ): MatchEvaluation | null {
    const companyName = this.normalizeCompanyName(company.name);
    const vendorName = this.normalizeCompanyName(vendor.displayName);
    if (!companyName || !vendorName) return null;

    if (companyName === vendorName) {
      return {
        confidence: 0.95,
        method: 'exact_name',
        reasons: ['normalized_name_exact_match'],
      };
    }

    const similarity = this.nameSimilarity(companyName, vendorName);
    if (similarity < 0.72) return null;

    return {
      confidence: this.roundConfidence(Math.min(0.84, similarity * 0.88)),
      method: 'fuzzy_name',
      reasons: ['normalized_name_fuzzy_match'],
    };
  }

  private toExistingMatch(
    company: CrmVendorCompanySummary,
    vendorsById: Map<string, QboVendorSummary>,
  ): ExistingQboVendorMatch | undefined {
    if (!company.qboVendorId) return undefined;
    return {
      vendorId: company.qboVendorId,
      ...(company.qboVendorName && { vendorName: company.qboVendorName }),
      ...(company.qboVendorMatchConfidence !== undefined && {
        matchConfidence: company.qboVendorMatchConfidence,
      }),
      ...(company.qboVendorMatchedAt && { matchedAt: company.qboVendorMatchedAt }),
      ...(company.qboVendorLastSyncedAt && {
        lastSyncedAt: company.qboVendorLastSyncedAt,
      }),
      vendorFoundInQbo: vendorsById.has(company.qboVendorId),
    };
  }

  private toStoredCandidate(
    company: CrmVendorCompanySummary,
    vendorsById: Map<string, QboVendorSummary>,
  ): QboVendorMatchCandidate | undefined {
    if (!company.qboVendorId) return undefined;
    const vendor = vendorsById.get(company.qboVendorId);
    if (!vendor) return undefined;
    const confidence = this.roundConfidence(
      company.qboVendorMatchConfidence ?? 1,
    );
    const status = this.statusForConfidence(confidence);
    return {
      vendorId: vendor.vendorId,
      vendorName: vendor.displayName || company.qboVendorName || vendor.vendorId,
      ...(vendor.email && { email: vendor.email }),
      ...(vendor.phone && { phone: vendor.phone }),
      confidence,
      method: 'stored',
      status,
      confirmed: status === 'confirmed',
      reasons: ['crm_company_has_stored_qbo_vendor_id'],
    };
  }

  private toVendorCrmMapEntry(
    vendor: QboVendorSummary,
    best:
      | { match: QboVendorCompanyMatch; candidate: QboVendorMatchCandidate }
      | undefined,
  ): QboVendorCrmMapEntry {
    const entry: QboVendorCrmMapEntry = {
      vendorId: vendor.vendorId,
      vendorName: vendor.displayName,
      ...(vendor.email && { vendorEmail: vendor.email }),
      ...(vendor.phone && { vendorPhone: vendor.phone }),
      matchStatus: best?.candidate.status ?? 'unmatched',
    };

    if (!best) return entry;

    return {
      ...entry,
      crmCompanyId: best.match.company.id,
      crmCompanyName: best.match.company.name,
      ...(best.match.company.type && { crmType: best.match.company.type }),
      matchConfidence: best.candidate.confidence,
      matchMethod: best.candidate.method,
    };
  }

  private isBetterVendorMapCandidate(
    match: QboVendorCompanyMatch,
    candidate: QboVendorMatchCandidate,
    current:
      | { match: QboVendorCompanyMatch; candidate: QboVendorMatchCandidate }
      | undefined,
  ): boolean {
    if (!current) return true;
    if (candidate.confidence !== current.candidate.confidence) {
      return candidate.confidence > current.candidate.confidence;
    }
    const statusRank = this.statusRank(candidate.status);
    const currentStatusRank = this.statusRank(current.candidate.status);
    if (statusRank !== currentStatusRank) return statusRank > currentStatusRank;
    return match.company.id < current.match.company.id;
  }

  private toCompanySummary(company: Company): CrmVendorCompanySummary {
    return {
      id: company.id,
      name: company.name,
      ...(company.type && { type: company.type }),
      ...(company.email && { email: company.email }),
      ...(company.phone && { phone: company.phone }),
      ...(company.qboVendorId && { qboVendorId: company.qboVendorId }),
      ...(company.qboVendorName && { qboVendorName: company.qboVendorName }),
      ...(company.qboVendorMatchConfidence !== undefined &&
        company.qboVendorMatchConfidence !== null && {
          qboVendorMatchConfidence: Number(company.qboVendorMatchConfidence),
        }),
      ...(company.qboVendorMatchedAt && {
        qboVendorMatchedAt: company.qboVendorMatchedAt,
      }),
      ...(company.qboVendorLastSyncedAt && {
        qboVendorLastSyncedAt: company.qboVendorLastSyncedAt,
      }),
    };
  }

  private normalizeOptions(options: QboVendorMatchingOptions): NormalizedOptions {
    return {
      ...(options.companyId !== undefined && { companyId: options.companyId }),
      minConfidence: this.clampConfidence(
        options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      ),
      includeLowConfidence: options.includeLowConfidence ?? false,
      maxCandidates: Math.max(1, Math.min(options.maxCandidates ?? 3, 20)),
    };
  }

  private countStatuses(
    matches: QboVendorCompanyMatch[],
  ): Record<QboVendorMatchStatus, number> {
    return matches.reduce<Record<QboVendorMatchStatus, number>>(
      (acc, match) => {
        acc[match.status] += 1;
        return acc;
      },
      {
        confirmed: 0,
        suggested: 0,
        low_confidence: 0,
        manual_match_protected: 0,
        unmatched: 0,
      },
    );
  }

  private statusForConfidence(confidence: number): QboVendorMatchStatus {
    if (confidence >= CONFIRMED_CONFIDENCE) return 'confirmed';
    if (confidence >= DEFAULT_MIN_CONFIDENCE) return 'suggested';
    if (confidence > 0) return 'low_confidence';
    return 'unmatched';
  }

  private compareCandidates(
    a: QboVendorMatchCandidate,
    b: QboVendorMatchCandidate,
  ): number {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return a.vendorName.localeCompare(b.vendorName);
  }

  private statusRank(status: QboVendorMatchStatus): number {
    switch (status) {
      case 'confirmed':
        return 5;
      case 'suggested':
        return 4;
      case 'low_confidence':
        return 3;
      case 'manual_match_protected':
        return 2;
      case 'unmatched':
        return 1;
    }
  }

  private normalizeCompanyName(value: string | undefined): string {
    const suffixes = new Set([
      'co',
      'company',
      'corp',
      'corporation',
      'inc',
      'incorporated',
      'limited',
      'llc',
      'llp',
      'lp',
      'ltd',
      'pc',
      'plc',
      'pllc',
    ]);
    return (value ?? '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token && !suffixes.has(token))
      .join(' ')
      .trim();
  }

  private normalizeEmail(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
  }

  private normalizePhone(value: string | undefined): string {
    const digits = (value ?? '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return digits;
  }

  private phoneMatches(companyPhone: string, vendorPhone: string): boolean {
    return (
      companyPhone === vendorPhone ||
      companyPhone.endsWith(vendorPhone) ||
      vendorPhone.endsWith(companyPhone)
    );
  }

  private nameSimilarity(a: string, b: string): number {
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    const substringScore =
      shorter.length >= 6 && longer.includes(shorter) ? 0.86 : 0;
    return Math.max(
      substringScore,
      this.tokenDiceSimilarity(a, b),
      this.levenshteinSimilarity(a, b),
    );
  }

  private tokenDiceSimilarity(a: string, b: string): number {
    const aTokens = new Set(a.split(/\s+/).filter(Boolean));
    const bTokens = new Set(b.split(/\s+/).filter(Boolean));
    if (!aTokens.size || !bTokens.size) return 0;
    const intersection = [...aTokens].filter((token) => bTokens.has(token));
    return (2 * intersection.length) / (aTokens.size + bTokens.size);
  }

  private levenshteinSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array<number>(b.length + 1);

    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + substitutionCost,
        );
      }
      for (let j = 0; j <= b.length; j += 1) {
        previous[j] = current[j];
      }
    }

    const distance = previous[b.length];
    return 1 - distance / Math.max(a.length, b.length);
  }

  private clampConfidence(value: number): number {
    return this.roundConfidence(Math.max(0, Math.min(1, value)));
  }

  private roundConfidence(value: number): number {
    return Math.round(value * 10000) / 10000;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
