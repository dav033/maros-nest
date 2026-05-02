import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from './quickbooks-api.service';
import { QuickbooksFinancialsService } from './quickbooks-financials.service';
import {
  QboAiWarning,
  QboNormalizedTransaction,
  QboRef,
  QuickbooksNormalizerService,
} from './quickbooks-normalizer.service';

export interface QboAttachmentEntityRef {
  entityType: string;
  entityId: string;
  name?: string;
}

export interface QboAttachmentOptions {
  includeTempDownloadUrl?: boolean;
}

export interface QboProjectAttachmentsParams extends QboAttachmentOptions {
  realmId?: string;
  projectNumber?: string;
  qboCustomerId?: string;
  startDate?: string;
  endDate?: string;
}

export interface QboNormalizedAttachment {
  attachmentId: string;
  fileName: string;
  contentType: string;
  size: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  linkedEntityType: string;
  linkedEntityId: string;
  includeOnSend: boolean;
  hasDownloadUrl: boolean;
  downloadUrlExpires: string | null;
  downloadUrlFetchedAt?: string;
  tempDownloadUrl?: string;
}

export interface QboAttachmentDownloadUrl {
  attachmentId: string;
  tempDownloadUrl: string;
  downloadUrlFetchedAt: string;
  downloadUrlExpires: string | null;
  warnings: QboAiWarning[];
}

export interface QboAttachmentEntityResult {
  entityRef: QboAttachmentEntityRef;
  attachments: QboNormalizedAttachment[];
  warnings: QboAiWarning[];
  fallbackUsed: boolean;
}

export type QboAttachmentLookupResult = QboAttachmentEntityResult;

export interface QboAttachmentsForEntitiesResult {
  attachments: QboNormalizedAttachment[];
  byEntity: QboAttachmentEntityResult[];
  warnings: QboAiWarning[];
  coverage: {
    entitiesChecked: number;
    attachmentsFound: number;
    fallbackUsed: boolean;
  };
}

export interface QboProjectAttachmentRef {
  found: boolean;
  projectNumber?: string;
  qboCustomerId?: string;
  displayName?: string;
  refs: QboRef[];
}

export interface QboProjectAttachmentsResult {
  project: QboProjectAttachmentRef;
  entityRefs: QboAttachmentEntityRef[];
  attachments: QboNormalizedAttachment[];
  byEntity: QboAttachmentEntityResult[];
  warnings: QboAiWarning[];
  coverage: {
    entitiesChecked: number;
    attachmentsFound: number;
    fallbackUsed: boolean;
  };
}

type ProjectAttachmentEntity =
  | 'Customer'
  | 'Invoice'
  | 'Estimate'
  | 'Payment'
  | 'Purchase'
  | 'Bill'
  | 'BillPayment'
  | 'VendorCredit'
  | 'PurchaseOrder'
  | 'JournalEntry';

interface QboCustomerRecord {
  Id?: unknown;
  DisplayName?: unknown;
  FullyQualifiedName?: unknown;
  [key: string]: unknown;
}

interface ProjectTransactionRef {
  entityType: ProjectAttachmentEntity;
  entityId: string;
  normalized?: QboNormalizedTransaction;
}

@Injectable()
export class QuickbooksAttachmentsService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly financials: QuickbooksFinancialsService,
  ) {}

  async getAttachmentsForEntity(
    realmId: string,
    entityType: string,
    entityId: string,
    options: QboAttachmentOptions = {},
  ): Promise<QboAttachmentLookupResult> {
    const entityRef: QboAttachmentEntityRef = { entityType, entityId };
    let fallbackUsed = false;
    let rawAttachments: Record<string, unknown>[] = [];
    const warnings: QboAiWarning[] = [];

    try {
      rawAttachments = await this.queryAttachablesByRef(realmId, entityRef);
    } catch {
      fallbackUsed = true;
      warnings.push(
        this.normalizer.warning(
          'attachment_lookup_fallback_used',
          `AttachableRef filter failed for ${entityType} ${entityId}; used paginated Attachable scan with in-memory filtering.`,
        ),
      );
      rawAttachments = await this.queryAttachablesByFallback(
        realmId,
        entityRef,
      );
    }

    const attachments = await this.normalizeAttachmentsForEntity(
      realmId,
      entityRef,
      rawAttachments,
      options,
      warnings,
    );

    if (!attachments.length) {
      warnings.push(
        this.normalizer.warning(
          'transaction_without_attachment',
          `${entityType} ${entityId} has no QuickBooks attachment metadata.`,
        ),
      );
    }

    return {
      entityRef,
      attachments,
      warnings: this.normalizer.dedupeWarnings(warnings),
      fallbackUsed,
    };
  }

  async getAttachmentsForEntities(
    realmId: string,
    entityRefs: QboAttachmentEntityRef[],
    options: QboAttachmentOptions = {},
  ): Promise<QboAttachmentsForEntitiesResult> {
    const uniqueRefs = this.uniqueEntityRefs(entityRefs);
    const byEntity = await Promise.all(
      uniqueRefs.map((ref) =>
        this.getAttachmentsForEntity(
          realmId,
          ref.entityType,
          ref.entityId,
          options,
        ),
      ),
    );
    const attachments = byEntity.flatMap((entity) => entity.attachments);
    const warnings = this.normalizer.dedupeWarnings(
      byEntity.flatMap((entity) => entity.warnings),
    );

    return {
      attachments,
      byEntity,
      warnings,
      coverage: {
        entitiesChecked: uniqueRefs.length,
        attachmentsFound: attachments.length,
        fallbackUsed: byEntity.some((entity) => entity.fallbackUsed),
      },
    };
  }

  async getProjectAttachments(
    params: QboProjectAttachmentsParams,
  ): Promise<QboProjectAttachmentsResult> {
    const realmId = await this.resolveRealmId(params.realmId);
    const project = await this.findProjectRefs(realmId, params);
    const warnings: QboAiWarning[] = [];

    if (!this.hasProjectIdentity(project)) {
      warnings.push(
        this.normalizer.warning(
          'PROJECT_NOT_RESOLVED',
          'Provide projectNumber or qboCustomerId to collect project attachments.',
        ),
      );
      return {
        project,
        entityRefs: [],
        attachments: [],
        byEntity: [],
        warnings,
        coverage: {
          entitiesChecked: 0,
          attachmentsFound: 0,
          fallbackUsed: false,
        },
      };
    }

    const entityRefs = await this.getProjectRelatedEntityRefs(
      realmId,
      project,
      params,
    );
    const attachmentResult = await this.getAttachmentsForEntities(
      realmId,
      entityRefs,
      { includeTempDownloadUrl: params.includeTempDownloadUrl },
    );

    return {
      project,
      entityRefs,
      attachments: attachmentResult.attachments,
      byEntity: attachmentResult.byEntity,
      warnings: this.normalizer.dedupeWarnings([
        ...warnings,
        ...attachmentResult.warnings,
      ]),
      coverage: attachmentResult.coverage,
    };
  }

  async getAttachmentDownloadUrl(
    realmId: string,
    attachableId: string,
  ): Promise<QboAttachmentDownloadUrl> {
    const raw = await this.apiService.getById(
      realmId,
      'attachable',
      attachableId,
    );
    const attachable = this.apiService.unwrapQboEntity(raw, 'Attachable');
    const tempDownloadUrl = this.stringValue(attachable['TempDownloadUri']);
    const warnings: QboAiWarning[] = [];

    if (!tempDownloadUrl) {
      warnings.push(
        this.normalizer.warning(
          'attachment_download_url_not_requested',
          `QuickBooks did not return a temporary download URL for attachment ${attachableId}.`,
        ),
      );
    }

    return {
      attachmentId: attachableId,
      tempDownloadUrl,
      downloadUrlFetchedAt: new Date().toISOString(),
      downloadUrlExpires: null,
      warnings,
    };
  }

  private async queryAttachablesByRef(
    realmId: string,
    ref: QboAttachmentEntityRef,
  ): Promise<Record<string, unknown>[]> {
    const entityType = this.apiService.escapeQboString(ref.entityType);
    const entityId = this.apiService.escapeQboString(ref.entityId);
    const rows = await this.apiService.queryAll(realmId, 'Attachable', {
      where:
        `AttachableRef.EntityRef.Type = '${entityType}' ` +
        `AND AttachableRef.EntityRef.Value = '${entityId}'`,
    });
    return rows.map((row) => this.asRecord(row));
  }

  private async queryAttachablesByFallback(
    realmId: string,
    ref: QboAttachmentEntityRef,
  ): Promise<Record<string, unknown>[]> {
    // QBO's nested AttachableRef filters are not reliable in every realm;
    // the fallback keeps SELECT * pagination and filters the full page locally.
    const rows = await this.apiService.queryAll(realmId, 'Attachable');
    return rows
      .map((row) => this.asRecord(row))
      .filter((attachment) => this.attachmentLinksToEntity(attachment, ref));
  }

  private async normalizeAttachmentsForEntity(
    realmId: string,
    entityRef: QboAttachmentEntityRef,
    attachments: Record<string, unknown>[],
    options: QboAttachmentOptions,
    warnings: QboAiWarning[],
  ): Promise<QboNormalizedAttachment[]> {
    const result: QboNormalizedAttachment[] = [];
    for (const raw of attachments) {
      const linkedRefs = this.extractAttachableRefs(raw).filter(
        (ref) =>
          ref.entityType === entityRef.entityType &&
          ref.entityId === entityRef.entityId,
      );
      const refs = linkedRefs.length ? linkedRefs : [entityRef];

      for (const ref of refs) {
        result.push(
          await this.normalizeAttachment(
            realmId,
            raw,
            ref,
            options,
            warnings,
          ),
        );
      }
    }
    return result;
  }

  private async normalizeAttachment(
    realmId: string,
    raw: Record<string, unknown>,
    entityRef: QboAttachmentEntityRef,
    options: QboAttachmentOptions,
    warnings: QboAiWarning[],
  ): Promise<QboNormalizedAttachment> {
    const attachmentId = this.stringValue(raw['Id']);
    const fileName = this.stringValue(raw['FileName']);
    const tempDownloadUrlFromRaw = this.stringValue(raw['TempDownloadUri']);
    const includeTempDownloadUrl = options.includeTempDownloadUrl === true;
    let tempDownloadUrl = '';
    let downloadUrlFetchedAt: string | undefined;

    if (!fileName) {
      warnings.push(
        this.normalizer.warning(
          'attachment_without_file_name',
          `Attachment ${attachmentId || '(unknown)'} has no file name.`,
        ),
      );
    }

    if (includeTempDownloadUrl) {
      if (tempDownloadUrlFromRaw) {
        tempDownloadUrl = tempDownloadUrlFromRaw;
        downloadUrlFetchedAt = new Date().toISOString();
      } else if (attachmentId) {
        const download = await this.getAttachmentDownloadUrl(
          realmId,
          attachmentId,
        );
        tempDownloadUrl = download.tempDownloadUrl;
        downloadUrlFetchedAt = download.downloadUrlFetchedAt;
        warnings.push(...download.warnings);
      }
    } else if (fileName || tempDownloadUrlFromRaw) {
      warnings.push(
        this.normalizer.warning(
          'attachment_download_url_not_requested',
          `Temporary download URL for attachment ${attachmentId || '(unknown)'} was not requested.`,
        ),
      );
    }

    const metadata = this.asRecord(raw['MetaData']);
    const normalized: QboNormalizedAttachment = {
      attachmentId,
      fileName,
      contentType: this.stringValue(raw['ContentType']),
      size: raw['Size'] == null ? null : this.numberValue(raw['Size']),
      note: this.stringValue(raw['Note']),
      createdAt: this.stringValue(metadata['CreateTime']),
      updatedAt: this.stringValue(metadata['LastUpdatedTime']),
      linkedEntityType: entityRef.entityType,
      linkedEntityId: entityRef.entityId,
      includeOnSend: this.includeOnSend(raw, entityRef),
      hasDownloadUrl: !!(fileName || tempDownloadUrlFromRaw || tempDownloadUrl),
      downloadUrlExpires: null,
    };

    if (includeTempDownloadUrl && downloadUrlFetchedAt) {
      normalized.downloadUrlFetchedAt = downloadUrlFetchedAt;
    }
    if (includeTempDownloadUrl && tempDownloadUrl) {
      normalized.tempDownloadUrl = tempDownloadUrl;
    }

    return normalized;
  }

  private async getProjectRelatedEntityRefs(
    realmId: string,
    project: QboProjectAttachmentRef,
    params: QboProjectAttachmentsParams,
  ): Promise<QboAttachmentEntityRef[]> {
    const refs: QboAttachmentEntityRef[] = [];
    const customerId = project.qboCustomerId || project.refs.find((ref) => ref.value)?.value;
    if (customerId) {
      refs.push({
        entityType: 'Customer',
        entityId: customerId,
        ...(project.displayName && { name: project.displayName }),
      });
    }

    const options = this.apiService.buildDateWhereClause(params);
    const [
      invoices,
      estimates,
      payments,
      purchases,
      bills,
      billPayments,
      vendorCredits,
      purchaseOrders,
      journalEntries,
    ] = await Promise.all([
      this.apiService.queryAll(realmId, 'Invoice', options),
      this.apiService.queryAll(realmId, 'Estimate', options),
      this.apiService.queryAll(realmId, 'Payment', options),
      this.apiService.queryAll(realmId, 'Purchase', options),
      this.apiService.queryAll(realmId, 'Bill', options),
      this.apiService.queryAll(realmId, 'BillPayment', options),
      this.apiService.queryAll(realmId, 'VendorCredit', options),
      this.apiService.queryAll(realmId, 'PurchaseOrder', options),
      this.apiService.queryAll(realmId, 'JournalEntry', options),
    ]);

    const projectBillIds = new Set<string>();
    const transactionRefs: ProjectTransactionRef[] = [];

    for (const raw of invoices.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Invoice',
        raw,
        this.normalizer.normalizeInvoice(raw),
        project,
      );
    }
    for (const raw of estimates.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Estimate',
        raw,
        this.normalizer.normalizeEstimate(raw),
        project,
      );
    }
    for (const raw of payments.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Payment',
        raw,
        this.normalizer.normalizePayment(raw),
        project,
      );
    }
    for (const raw of purchases.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Purchase',
        raw,
        this.normalizer.normalizePurchase(raw),
        project,
      );
    }
    for (const raw of bills.map((row) => this.asRecord(row))) {
      const normalized = this.normalizer.normalizeBill(raw);
      const added = this.addProjectTransactionRef(
        transactionRefs,
        'Bill',
        raw,
        normalized,
        project,
      );
      if (added) projectBillIds.add(normalized.entityId);
    }
    for (const raw of vendorCredits.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'VendorCredit',
        raw,
        this.normalizer.normalizeVendorCredit(raw),
        project,
      );
    }
    for (const raw of purchaseOrders.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'PurchaseOrder',
        raw,
        this.normalizer.normalizePurchaseOrder(raw),
        project,
      );
    }
    for (const raw of journalEntries.map((row) => this.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'JournalEntry',
        raw,
        this.normalizer.normalizeJournalEntry(raw),
        project,
      );
    }
    for (const raw of billPayments.map((row) => this.asRecord(row))) {
      const normalized = this.normalizer.normalizeBillPayment(raw);
      const linksProjectBill = normalized.linkedTxn.some(
        (linked) =>
          linked.txnType === 'Bill' && projectBillIds.has(linked.txnId),
      );
      if (linksProjectBill || this.transactionMatchesProject(normalized, project)) {
        transactionRefs.push({
          entityType: 'BillPayment',
          entityId: normalized.entityId || this.stringValue(raw['Id']),
          normalized,
        });
      }
    }

    for (const ref of transactionRefs) {
      if (!ref.entityId) continue;
      refs.push({
        entityType: ref.entityType,
        entityId: ref.entityId,
      });
    }

    return this.uniqueEntityRefs(refs);
  }

  private addProjectTransactionRef(
    refs: ProjectTransactionRef[],
    entityType: ProjectAttachmentEntity,
    raw: Record<string, unknown>,
    normalized: QboNormalizedTransaction,
    project: QboProjectAttachmentRef,
  ): boolean {
    if (!this.transactionMatchesProject(normalized, project)) return false;
    refs.push({
      entityType,
      entityId: normalized.entityId || this.stringValue(raw['Id']),
      normalized,
    });
    return true;
  }

  private async findProjectRefs(
    realmId: string,
    params: Pick<
      QboProjectAttachmentsParams,
      'projectNumber' | 'qboCustomerId'
    >,
  ): Promise<QboProjectAttachmentRef> {
    const projectNumber = this.trim(params.projectNumber);
    const qboCustomerId = this.trim(params.qboCustomerId);

    if (qboCustomerId) {
      const raw = await this.apiService.getCustomer(realmId, qboCustomerId);
      const customer = this.apiService.unwrapQboEntity(raw, 'Customer');
      const displayName = this.stringValue(customer['DisplayName']);
      return {
        found: true,
        ...(projectNumber && { projectNumber }),
        qboCustomerId,
        ...(displayName && { displayName }),
        refs: [
          {
            value: qboCustomerId,
            ...(displayName && { name: displayName }),
          },
        ],
      };
    }

    if (!projectNumber) return { found: false, refs: [] };

    const jobs = (await this.apiService.queryAll(realmId, 'Customer', {
      where: 'Job = true',
    })) as QboCustomerRecord[];
    const match =
      jobs.find((customer) =>
        this.customerMatchesProjectNumber(customer, projectNumber),
      ) ??
      (
        (await this.apiService.queryAll(
          realmId,
          'Customer',
        )) as QboCustomerRecord[]
      ).find((customer) =>
        this.customerMatchesProjectNumber(customer, projectNumber),
      );

    if (!match) {
      return {
        found: false,
        projectNumber,
        refs: [{ value: '', name: projectNumber }],
      };
    }

    const id = this.stringValue(match.Id);
    const displayName = this.stringValue(match.DisplayName);
    return {
      found: true,
      projectNumber,
      qboCustomerId: id,
      ...(displayName && { displayName }),
      refs: [
        {
          value: id,
          ...(displayName && { name: displayName }),
        },
      ],
    };
  }

  private customerMatchesProjectNumber(
    customer: QboCustomerRecord,
    projectNumber: string,
  ): boolean {
    const normalizedProject = this.normalizeName(projectNumber);
    const values = [
      this.stringValue(customer.Id),
      this.stringValue(customer.DisplayName),
      this.stringValue(customer.FullyQualifiedName),
      this.stringValue(customer['Name']),
      this.stringValue(customer['ProjectNumber']),
    ];
    return values.some((value) =>
      this.nameMatchesProject(this.normalizeName(value), normalizedProject),
    );
  }

  private transactionMatchesProject(
    txn: QboNormalizedTransaction,
    project: QboProjectAttachmentRef,
  ): boolean {
    if (!this.hasProjectIdentity(project)) return false;
    return txn.projectRefs.some((ref) => this.projectRefMatches(ref, project));
  }

  private projectRefMatches(ref: QboRef, project: QboProjectAttachmentRef): boolean {
    const projectIds = new Set(
      project.refs.map((projectRef) => projectRef.value).filter(Boolean),
    );
    if (ref.value && projectIds.has(ref.value)) return true;

    const refName = this.normalizeName(ref.name);
    if (!refName) return false;

    const projectNames = [
      project.projectNumber,
      project.displayName,
      ...project.refs.map((projectRef) => projectRef.name),
    ]
      .map((value) => this.normalizeName(value))
      .filter(Boolean);

    return projectNames.some((candidate) =>
      this.nameMatchesProject(refName, candidate),
    );
  }

  private hasProjectIdentity(project: QboProjectAttachmentRef): boolean {
    return project.refs.some((ref) => ref.value || ref.name);
  }

  private attachmentLinksToEntity(
    attachment: Record<string, unknown>,
    entityRef: QboAttachmentEntityRef,
  ): boolean {
    return this.extractAttachableRefs(attachment).some(
      (ref) =>
        ref.entityType === entityRef.entityType &&
        ref.entityId === entityRef.entityId,
    );
  }

  private extractAttachableRefs(
    raw: Record<string, unknown>,
  ): QboAttachmentEntityRef[] {
    return this.asArray(raw['AttachableRef'])
      .map((ref) => {
        const entityRef = this.asRecord(ref['EntityRef']);
        const entityType = this.stringValue(entityRef['type']);
        const entityId = this.stringValue(entityRef['value']);
        if (!entityType || !entityId) return null;
        const name = this.stringValue(entityRef['name']);
        const result: QboAttachmentEntityRef = {
          entityType,
          entityId,
        };
        if (name) result.name = name;
        return result;
      })
      .filter((ref): ref is QboAttachmentEntityRef => ref !== null);
  }

  private includeOnSend(
    raw: Record<string, unknown>,
    entityRef: QboAttachmentEntityRef,
  ): boolean {
    const attachableRef = this.asArray(raw['AttachableRef']).find((ref) => {
      const qboEntityRef = this.asRecord(ref['EntityRef']);
      return (
        this.stringValue(qboEntityRef['type']) === entityRef.entityType &&
        this.stringValue(qboEntityRef['value']) === entityRef.entityId
      );
    });
    return attachableRef ? Boolean(attachableRef['IncludeOnSend']) : false;
  }

  private uniqueEntityRefs(
    entityRefs: QboAttachmentEntityRef[],
  ): QboAttachmentEntityRef[] {
    const refs = new Map<string, QboAttachmentEntityRef>();
    for (const ref of entityRefs) {
      if (!ref.entityType || !ref.entityId) continue;
      refs.set(`${ref.entityType}:${ref.entityId}`, ref);
    }
    return [...refs.values()];
  }

  private async resolveRealmId(realmId?: string): Promise<string> {
    return this.trim(realmId) || this.financials.getDefaultRealmId();
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  }

  private stringValue(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return '';
  }

  private numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private trim(value: unknown): string {
    return this.stringValue(value).trim();
  }

  private normalizeName(value: unknown): string {
    return this.trim(value).toLowerCase();
  }

  private nameMatchesProject(value: string, project: string): boolean {
    if (!value || !project) return false;
    if (value === project) return true;
    if (value.startsWith(`${project},`)) return true;
    const parts = value
      .split(/[:,]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.includes(project);
  }
}
