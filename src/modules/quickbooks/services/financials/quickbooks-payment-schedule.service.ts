import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QBO_ATTACHMENT_CONCURRENCY, runWithConcurrency } from '../core/quickbooks-concurrency.utils';
import { QuickbooksAttachmentsHelpers } from '../attachments/quickbooks-attachments.helpers';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';
import {
  PaymentSchedule,
  PaymentScheduleItem,
} from './quickbooks-financials.types';

type QboTransaction = Record<string, unknown> & {
  Id?: unknown;
  CustomerRef?: unknown;
};

type Candidate = {
  projectNumber: string;
  entityType: 'Estimate' | 'Invoice';
  entityId: string;
  attachment: Record<string, unknown>;
};

type ParsedSchedule = Omit<PaymentSchedule, 'source'>;

const PDF_CONTENT_TYPE = 'application/pdf';
const PDF_DOWNLOAD_TIMEOUT_MS = 20_000;
const PDF_MAX_BYTES = 12 * 1024 * 1024;

@Injectable()
export class QuickbooksPaymentScheduleService {
  private readonly logger = new Logger(QuickbooksPaymentScheduleService.name);
  private readonly helpers = new QuickbooksAttachmentsHelpers();

  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly contextService: QuickbooksFinancialsContextService,
  ) {}

  /**
   * Finds the first readable Payment Schedule PDF attached to an Estimate or
   * Invoice for each project. Metadata is fetched in batches; PDF downloads
   * stay bounded so this does not multiply QBO requests per project.
   */
  async getByProjects(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<Map<string, PaymentSchedule | null>> {
    const result = new Map<string, PaymentSchedule | null>(
      [...new Set(projectNumbers.filter(Boolean))].map((number) => [number, null]),
    );
    if (!projectNumbers.length) return result;

    try {
      const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
      const context = await this.contextService.resolveJobs(effectiveRealmId, projectNumbers);
      if (!context.jobIds.length) return result;

      const customerIds = context.jobIds
        .map((id) => `'${String(id).replace(/'/g, "\\'")}'`)
        .join(',');
      const [estimates, invoices, attachments] = await Promise.all([
        this.apiService.queryAll(effectiveRealmId, 'Estimate', {
          where: `CustomerRef IN (${customerIds})`,
          select: 'Id, CustomerRef',
          cacheKey: 'payment-schedule-transactions',
        }) as Promise<QboTransaction[]>,
        this.apiService.queryAll(effectiveRealmId, 'Invoice', {
          where: `CustomerRef IN (${customerIds})`,
          select: 'Id, CustomerRef',
          cacheKey: 'payment-schedule-transactions',
        }) as Promise<QboTransaction[]>,
        this.apiService.queryAll(effectiveRealmId, 'Attachable', {
          select: 'Id, FileName, ContentType, Size, Note, AttachableRef',
          cacheKey: 'payment-schedule-attachments',
        }) as Promise<Record<string, unknown>[]>,
      ]);

      const projectByTransaction = this.indexTransactions(
        estimates,
        invoices,
        context.jobIds,
        context.jobMap,
      );
      const candidates = this.buildCandidates(attachments, projectByTransaction);
      const parsed = await runWithConcurrency(
        candidates.map((candidate) => async () =>
          this.readCandidate(effectiveRealmId, candidate),
        ),
        QBO_ATTACHMENT_CONCURRENCY,
      );

      for (const schedule of parsed) {
        if (!schedule) continue;
        const current = result.get(schedule.projectNumber);
        if (current) continue;
        result.set(schedule.projectNumber, schedule.value);
      }
    } catch (error) {
      this.logger.warn(
        `Payment Schedule lookup skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  parseText(text: string): ParsedSchedule | null {
    const lines = text
      .replace(/\u00a0/g, ' ')
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const heading = lines.findIndex((line) => /payment\s+schedule/i.test(line));
    if (heading < 0) return null;

    const body = lines.slice(heading + 1, heading + 45);
    const inlineRows = body.flatMap((line) => {
      const match = line.match(
        /^(.+?)\s+(\d+(?:\.\d+)?)\s*%\s+\$?\s*([\d,]+(?:\.\d{2})?)$/,
      );
      if (!match) return [];
      const label = match[1].trim();
      const percentage = Number(match[2]);
      const amount = Number(match[3].replace(/,/g, ''));
      if (!label || !Number.isFinite(percentage) || !Number.isFinite(amount)) return [];
      return [{ label, percentage, amount }];
    });
    if (inlineRows.length) {
      const scheduleRows = inlineRows.filter((row) => !/^total\b/i.test(row.label));
      if (!scheduleRows.length) return null;
      const totalRow = inlineRows.find((row) => /^total\b/i.test(row.label));
      return {
        items: scheduleRows,
        totalPercentage: totalRow?.percentage ?? scheduleRows.reduce((sum, item) => sum + item.percentage, 0),
        totalAmount: totalRow?.amount ?? scheduleRows.reduce((sum, item) => sum + item.amount, 0),
      };
    }

    const percentRows = body
      .map((line, index) => ({ line, index, percentage: this.parsePercentage(line) }))
      .filter((row): row is { line: string; index: number; percentage: number } => row.percentage !== null);
    if (!percentRows.length) return null;

    const moneyRows = body
      .map((line, index) => ({ line, index, amount: this.parseMoney(line) }))
      .filter((row): row is { line: string; index: number; amount: number } => row.amount !== null);
    const orderedAmounts = moneyRows.map((row) => row.amount);
    const items: PaymentScheduleItem[] = [];

    percentRows.forEach((row, rowIndex) => {
      const nextPercentIndex = percentRows[rowIndex + 1]?.index ?? Number.POSITIVE_INFINITY;
      const amountAfter = moneyRows.find(
        (money) => money.index > row.index && money.index < nextPercentIndex,
      );
      const amount = amountAfter?.amount ?? orderedAmounts[rowIndex] ?? null;
      const label = this.findLabel(body, row.index, percentRows[rowIndex - 1]?.index);
      if (/^total$/i.test(label)) return;
      items.push({
        label: label || `Payment ${items.length + 1}`,
        percentage: row.percentage,
        amount,
      });
    });

    if (!items.length) return null;
    const totalRow = percentRows.find((row) => /^total\b/i.test(row.line));
    const totalPercentage = totalRow?.percentage ?? items.reduce((sum, item) => sum + item.percentage, 0);
    const totalAmount = this.findTotalAmount(body, totalRow?.index) ?? this.sumAmounts(items);

    return {
      items,
      totalPercentage,
      totalAmount,
    };
  }

  private indexTransactions(
    estimates: QboTransaction[],
    invoices: QboTransaction[],
    jobIds: string[],
    jobMap: Record<string, string>,
  ): Map<string, { projectNumber: string; entityType: 'Estimate' | 'Invoice'; entityId: string }> {
    const projectByJobId = new Map(
      Object.entries(jobMap).map(([projectNumber, jobId]) => [String(jobId), projectNumber]),
    );
    const validJobIds = new Set(jobIds.map(String));
    const result = new Map<string, { projectNumber: string; entityType: 'Estimate' | 'Invoice'; entityId: string }>();

    for (const [entityType, rows] of [
      ['Estimate', estimates],
      ['Invoice', invoices],
    ] as const) {
      for (const row of rows) {
        const entityId = this.helpers.stringValue(row.Id);
        const customerRef = this.helpers.asRecord(row.CustomerRef);
        const customerId = this.helpers.stringValue(customerRef['value'] ?? row.CustomerRef);
        const projectNumber = validJobIds.has(customerId) ? projectByJobId.get(customerId) : undefined;
        if (!entityId || !projectNumber) continue;
        result.set(`${entityType}:${entityId}`, { projectNumber, entityType, entityId });
      }
    }
    return result;
  }

  private buildCandidates(
    attachments: Record<string, unknown>[],
    projectByTransaction: Map<string, { projectNumber: string; entityType: 'Estimate' | 'Invoice'; entityId: string }>,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const attachment of attachments) {
      const fileName = this.helpers.stringValue(attachment['FileName']);
      const contentType = this.helpers.stringValue(attachment['ContentType']).toLowerCase();
      if (contentType !== PDF_CONTENT_TYPE && !/\.pdf$/i.test(fileName)) continue;
      const attachmentId = this.helpers.stringValue(attachment['Id']);
      for (const ref of this.helpers.extractAttachableRefs(attachment)) {
        if (ref.entityType !== 'Estimate' && ref.entityType !== 'Invoice') continue;
        const transaction = projectByTransaction.get(`${ref.entityType}:${ref.entityId}`);
        if (!transaction) continue;
        const key = `${transaction.projectNumber}:${attachmentId || fileName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ ...transaction, attachment });
      }
    }
    return candidates.sort((a, b) => {
      if (a.entityType !== b.entityType) return a.entityType === 'Estimate' ? -1 : 1;
      return a.projectNumber.localeCompare(b.projectNumber);
    });
  }

  private async readCandidate(
    realmId: string,
    candidate: Candidate,
  ): Promise<{ projectNumber: string; value: PaymentSchedule } | null> {
    try {
      const attachmentId = this.helpers.stringValue(candidate.attachment['Id']);
      let downloadUrl = this.helpers.stringValue(candidate.attachment['TempDownloadUri']);
      if (!downloadUrl && attachmentId) {
        const raw = await this.apiService.getById(realmId, 'attachable', attachmentId);
        const attachable = this.apiService.unwrapQboEntity(raw, 'Attachable');
        downloadUrl = this.helpers.stringValue(attachable['TempDownloadUri']);
      }
      if (!downloadUrl) return null;

      const response = await axios.get<ArrayBuffer>(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: PDF_DOWNLOAD_TIMEOUT_MS,
        maxContentLength: PDF_MAX_BYTES,
        maxBodyLength: PDF_MAX_BYTES,
      });
      const parsed = this.parseText((await pdfParse(Buffer.from(response.data))).text);
      if (!parsed) return null;

      return {
        projectNumber: candidate.projectNumber,
        value: {
          ...parsed,
          source: {
            attachmentId,
            fileName: this.helpers.stringValue(candidate.attachment['FileName']),
            entityType: candidate.entityType,
            entityId: candidate.entityId,
          },
        },
      };
    } catch (error) {
      this.logger.debug(
        `Payment Schedule PDF skipped for ${candidate.projectNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private findLabel(lines: string[], percentIndex: number, previousPercentIndex?: number): string {
    const start = previousPercentIndex === undefined ? 0 : previousPercentIndex + 1;
    return lines
      .slice(start, percentIndex)
      .filter((line) => !this.parseMoney(line) && this.parsePercentage(line) === null)
      .filter((line) => !/^(payment schedule|amount|percentage|description)$/i.test(line))
      .join(' ')
      .replace(/\b(total|payment instructions)\b/gi, (match) => match)
      .trim();
  }

  private findTotalAmount(lines: string[], totalIndex?: number): number | null {
    if (totalIndex === undefined) return null;
    const money = lines
      .slice(totalIndex, totalIndex + 4)
      .map((line) => this.parseMoney(line))
      .find((value): value is number => value !== null);
    return money ?? null;
  }

  private sumAmounts(items: PaymentScheduleItem[]): number | null {
    const amounts = items.map((item) => item.amount).filter((amount): amount is number => amount !== null);
    return amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  }

  private parsePercentage(line: string): number | null {
    const match = line.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private parseMoney(line: string): number | null {
    if (!/^\$?\s*-?[\d,]+(?:\.\d{2})?$/.test(line)) return null;
    const value = Number(line.replace(/[$,\s]/g, ''));
    return Number.isFinite(value) ? value : null;
  }
}
