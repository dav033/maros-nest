import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../entities/qbo-connection.entity';
import { QuickbooksApiService } from './quickbooks-api.service';
import { QboReauthorizationRequiredException } from '../exceptions/qbo-reauthorization-required.exception';
import {
  QboAttachmentSummary,
  QboCashInTransaction,
  QboCashOutTransaction,
  QboNormalizedTransaction,
  QboRef,
  QuickbooksNormalizerService,
} from './quickbooks-normalizer.service';

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface ProjectFinancials {
  projectNumber: string;
  /** false when no QBO job was found for this project number */
  found: boolean;
  estimatedAmount: number;
  estimateCount: number;
  invoicedAmount: number;
  invoiceCount: number;
  paidAmount: number;
  outstandingAmount: number;
  /** Percentage of invoiced amount that has been paid (0–100, rounded to 2 decimals) */
  paidPercentage: number;
  /** estimatedAmount − invoicedAmount (positive = over-estimated) */
  estimateVsInvoicedDelta: number;
}

export type InvoiceSummary = QboCashInTransaction;

export interface UnbilledWorkResult {
  projectNumber: string;
  found: boolean;
  job: Record<string, unknown> | null;
  totalEstimated: number;
  totalInvoiced: number;
  /** totalEstimated − totalInvoiced */
  unbilledAmount: number;
  /** Normalized Estimate transactions with line items */
  estimates: QboNormalizedTransaction[];
  /** Normalized Invoice transactions with line items */
  invoices: QboCashInTransaction[];
}

export interface ProjectDetail {
  projectNumber: string;
  /** false when the project number was not found as a QBO job */
  found: boolean;
  /** QBO sub-customer (Job) record — null when not found */
  job: Record<string, unknown> | null;
  /** Aggregated financial summary */
  financials: Omit<ProjectFinancials, 'projectNumber' | 'found'>;
  /** Normalized Estimate transactions including line items */
  estimates: QboNormalizedTransaction[];
  /** Normalized Invoice transactions including line items */
  invoices: QboCashInTransaction[];
  /** Normalized Payment transactions including linked transactions */
  payments: QboCashInTransaction[];
}

export type ExpenseItem = QboCashOutTransaction;

export type AttachmentItem = QboAttachmentSummary;

export interface PnlCategory {
  name: string;
  amount: number;
}

export interface ProjectProfitAndLoss {
  projectNumber: string;
  found: boolean;
  customerId: string | null;
  income: { total: number; categories: PnlCategory[] };
  costOfGoodsSold: { total: number; categories: PnlCategory[] };
  expenses: { total: number; categories: PnlCategory[] };
  grossProfit: number;
  netProfit: number;
}

export interface ProjectFullProfile {
  projectNumber: string;
  found: boolean;
  job: Record<string, unknown> | null;
  financials: Omit<ProjectFinancials, 'projectNumber' | 'found'>;
  estimates: QboNormalizedTransaction[];
  invoices: QboCashInTransaction[];
  payments: QboCashInTransaction[];
  expenses: ExpenseItem[];
  attachments: AttachmentItem[];
  profitAndLoss: ProjectProfitAndLoss | null;
}

// ---------------------------------------------------------------------------
// Internal QBO response shapes (minimal — only the fields we aggregate on)
// ---------------------------------------------------------------------------

interface QboCustomer {
  Id: string;
  DisplayName: string;
  [key: string]: unknown;
}

interface QboTxnBase {
  Id: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string } | string;
  [key: string]: unknown;
}

interface QboInvoice extends QboTxnBase {
  Balance: number;
}

interface QboCustomerResponse {
  QueryResponse?: { Customer?: QboCustomer[] };
}

interface QboEstimateResponse {
  QueryResponse?: { Estimate?: QboTxnBase[] };
}

interface QboInvoiceResponse {
  QueryResponse?: { Invoice?: QboInvoice[] };
}

interface QboPaymentResponse {
  QueryResponse?: { Payment?: Record<string, unknown>[] };
}

// Resolved job lookup context — shared between both public methods
interface JobContext {
  /** projectNumber → QBO customer ID */
  jobMap: Record<string, string>;
  /** projectNumber → full QBO Customer object */
  jobObjectMap: Record<string, QboCustomer>;
  /** deduplicated list of QBO customer IDs */
  jobIds: string[];
}

interface AttachmentEntityRef {
  entityType: string;
  entityId: string;
}

// ---------------------------------------------------------------------------

@Injectable()
export class QuickbooksFinancialsService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public methods — aggregated
  // ---------------------------------------------------------------------------

  /**
   * Returns aggregated financial summary per project number.
   * Mirrors the n8n "QuickBooks Job Financials - FAST v3" workflow.
   */
  async getProjectFinancials(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<ProjectFinancials[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const cleaned = this.deduplicateProjectNumbers(projectNumbers);
    if (!cleaned.length) return [];

    const ctx = await this.resolveJobs(effectiveRealmId, cleaned);
    if (!ctx.jobIds.length)
      return cleaned.map((pn) => this.emptyFinancials(pn));

    const { estimateQuery, invoiceQuery } = this.buildTxnQueries(
      ctx.jobIds,
      false,
    );

    const [estimatesResp, invoicesResp] = await Promise.all([
      this.apiService.query(
        effectiveRealmId,
        estimateQuery,
      ) as Promise<QboEstimateResponse>,
      this.apiService.query(
        effectiveRealmId,
        invoiceQuery,
      ) as Promise<QboInvoiceResponse>,
    ]);

    return this.aggregateFinancials(
      cleaned,
      ctx.jobMap,
      estimatesResp,
      invoicesResp,
    );
  }

  /**
   * Returns full transaction detail per project number:
   * the QBO job record, all Estimates, all Invoices (with line items),
   * all Payments, and the aggregated financial summary.
   */
  async getProjectDetail(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<ProjectDetail[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const cleaned = this.deduplicateProjectNumbers(projectNumbers);
    if (!cleaned.length) return [];

    const ctx = await this.resolveJobs(effectiveRealmId, cleaned);

    if (!ctx.jobIds.length) {
      return cleaned.map((pn) => this.emptyDetail(pn));
    }

    // Fetch full QBO objects, then normalize before exposing them to callers.
    const { estimateQuery, invoiceQuery, paymentQuery } = this.buildTxnQueries(
      ctx.jobIds,
      true,
    );

    const [estimatesResp, invoicesResp, paymentsResp] = await Promise.all([
      this.apiService.query(
        effectiveRealmId,
        estimateQuery,
      ) as Promise<QboEstimateResponse>,
      this.apiService.query(
        effectiveRealmId,
        invoiceQuery,
      ) as Promise<QboInvoiceResponse>,
      this.apiService.query(
        effectiveRealmId,
        paymentQuery!,
      ) as Promise<QboPaymentResponse>,
    ]);

    const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const payments = paymentsResp?.QueryResponse?.Payment ?? [];

    // Index transactions by job ID for fast lookup
    const estsByJob = this.indexByJobId<QboTxnBase>(estimates);
    const invsByJob = this.indexByJobId<QboInvoice>(invoices);
    const paysByJob = this.indexByJobId<Record<string, unknown>>(payments);

    return cleaned.map((pn) => {
      const jobId = ctx.jobMap[pn];
      if (!jobId) return this.emptyDetail(pn);

      const projEstimates = estsByJob[jobId] ?? [];
      const projInvoices = invsByJob[jobId] ?? [];
      const projPayments = paysByJob[jobId] ?? [];

      // Re-use aggregation logic on the per-project slices
      const estTotal = projEstimates.reduce(
        (s, e) => s + (Number(e.TotalAmt) || 0),
        0,
      );
      const invTotal = projInvoices.reduce(
        (s, i) => s + (Number(i.TotalAmt) || 0),
        0,
      );
      const outstanding = projInvoices.reduce(
        (s, i) => s + (Number(i.Balance) || 0),
        0,
      );
      const paidAmount = invTotal - outstanding;
      const paidPercentage = invTotal > 0 ? (paidAmount / invTotal) * 100 : 0;

      return {
        projectNumber: pn,
        found: true,
        job: ctx.jobObjectMap[pn] ?? null,
        financials: {
          estimatedAmount: estTotal,
          estimateCount: projEstimates.length,
          invoicedAmount: invTotal,
          invoiceCount: projInvoices.length,
          paidAmount,
          outstandingAmount: outstanding,
          paidPercentage: Math.round(paidPercentage * 100) / 100,
          estimateVsInvoicedDelta: estTotal - invTotal,
        },
        estimates: projEstimates.map((estimate) =>
          this.normalizer.normalizeEstimate(estimate),
        ),
        invoices: projInvoices.map((invoice) =>
          this.normalizer.normalizeInvoice(invoice),
        ),
        payments: projPayments.map((payment) =>
          this.normalizer.normalizePayment(payment),
        ),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Public methods — Tier 2 drill-down
  // ---------------------------------------------------------------------------

  /**
   * Returns all invoices for a project with status, dates, and amounts.
   * Each invoice's status is derived: Paid / Partial / Overdue / Pending.
   */
  async getInvoicesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<InvoiceSummary[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Invoice WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Invoice?: QboInvoice[] } };

    return (resp?.QueryResponse?.Invoice ?? []).map((invoice) =>
      this.normalizer.normalizeInvoice(invoice),
    );
  }

  /** Full Invoice object with line items fetched directly by QBO invoice ID. */
  async getInvoiceById(
    invoiceId: string,
    realmId?: string,
  ): Promise<QboCashInTransaction> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const resp = await this.apiService.getById(
      effectiveRealmId,
      'invoice',
      invoiceId,
    );
    return this.normalizer.normalizeInvoice(
      this.apiService.unwrapQboEntity(resp, 'Invoice'),
    );
  }

  /** All Estimates for a project, normalized with line items. */
  async getEstimatesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboNormalizedTransaction[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Estimate WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Estimate?: unknown[] } };

    return (resp?.QueryResponse?.Estimate ?? []).map((estimate) =>
      this.normalizer.normalizeEstimate(estimate as Record<string, unknown>),
    );
  }

  /** Full Estimate object with line items fetched directly by QBO estimate ID. */
  async getEstimateById(
    estimateId: string,
    realmId?: string,
  ): Promise<QboNormalizedTransaction> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const resp = await this.apiService.getById(
      effectiveRealmId,
      'estimate',
      estimateId,
    );
    return this.normalizer.normalizeEstimate(
      this.apiService.unwrapQboEntity(resp, 'Estimate'),
    );
  }

  /** All Payments for a project with date, method, and linked invoices. */
  async getPaymentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboCashInTransaction[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Payment WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Payment?: unknown[] } };

    return (resp?.QueryResponse?.Payment ?? []).map((payment) =>
      this.normalizer.normalizePayment(payment as Record<string, unknown>),
    );
  }

  /**
   * Returns the unbilled work breakdown for a project:
   * total estimated minus total invoiced, with normalized estimate and invoice
   * transactions so the caller can compare line items.
   */
  async getUnbilledWork(
    projectNumber: string,
    realmId?: string,
  ): Promise<UnbilledWorkResult> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );

    const empty: UnbilledWorkResult = {
      projectNumber,
      found: !!jobId,
      job: jobObject,
      totalEstimated: 0,
      totalInvoiced: 0,
      unbilledAmount: 0,
      estimates: [],
      invoices: [],
    };

    if (!jobId) return empty;

    const [estResp, invResp] = await Promise.all([
      this.apiService.query(
        effectiveRealmId,
        `SELECT * FROM Estimate WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<{ QueryResponse?: { Estimate?: QboTxnBase[] } }>,
      this.apiService.query(
        effectiveRealmId,
        `SELECT * FROM Invoice WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<{ QueryResponse?: { Invoice?: QboInvoice[] } }>,
    ]);

    const estimates = estResp?.QueryResponse?.Estimate ?? [];
    const invoices = invResp?.QueryResponse?.Invoice ?? [];

    const totalEstimated = estimates.reduce(
      (s, e) => s + (Number(e.TotalAmt) || 0),
      0,
    );
    const totalInvoiced = invoices.reduce(
      (s, i) => s + (Number(i.TotalAmt) || 0),
      0,
    );

    return {
      projectNumber,
      found: true,
      job: jobObject,
      totalEstimated,
      totalInvoiced,
      unbilledAmount: totalEstimated - totalInvoiced,
      estimates: estimates.map((estimate) =>
        this.normalizer.normalizeEstimate(estimate),
      ),
      invoices: invoices.map((invoice) =>
        this.normalizer.normalizeInvoice(invoice),
      ),
    };
  }

  /** All vendor expenses (Purchases) charged against a project in QuickBooks. */
  async getExpensesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<ExpenseItem[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const purchases = (await this.apiService.queryAll(
      effectiveRealmId,
      'Purchase',
    )) as Record<string, unknown>[];

    return purchases
      .map((purchase) => this.normalizer.normalizePurchase(purchase))
      .filter((purchase) =>
        this.transactionMatchesProject(
          purchase,
          jobId,
          projectNumber,
          jobObject?.DisplayName,
        ),
      );
  }

  /** Files and documents attached to a QuickBooks project (job). */
  async getAttachmentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<AttachmentItem[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const entityRefs = await this.getProjectRelatedEntityRefs(
      effectiveRealmId,
      projectNumber,
      jobId,
      jobObject?.DisplayName,
    );
    const attachables = await this.getAttachablesForEntityRefs(
      effectiveRealmId,
      entityRefs,
    );

    return attachables.map((attachment) =>
      this.normalizer.normalizeAttachable(attachment),
    );
  }

  /** QuickBooks Profit & Loss report for a specific project, broken down by category. */
  async getProjectProfitAndLoss(
    projectNumber: string,
    realmId?: string,
  ): Promise<ProjectProfitAndLoss> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );

    if (!jobId) {
      return {
        projectNumber,
        found: false,
        customerId: null,
        income: { total: 0, categories: [] },
        costOfGoodsSold: { total: 0, categories: [] },
        expenses: { total: 0, categories: [] },
        grossProfit: 0,
        netProfit: 0,
      };
    }

    const report = (await this.apiService.report(
      effectiveRealmId,
      'ProfitAndLoss',
      { customer: jobId },
    )) as Record<string, unknown>;

    return this.parseProfitAndLoss(projectNumber, jobId, report);
  }

  /**
   * Complete QuickBooks data for a single project: job record, financial summary,
   * all estimates, invoices, payments, expenses, attachments, and P&L report.
   * Resolves the job once and fires all queries in parallel.
   */
  async getProjectFullProfile(
    projectNumber: string,
    realmId?: string,
  ): Promise<ProjectFullProfile> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );

    if (!jobId) {
      return {
        projectNumber,
        found: false,
        job: null,
        financials: this.emptyDetail(projectNumber).financials,
        estimates: [],
        invoices: [],
        payments: [],
        expenses: [],
        attachments: [],
        profitAndLoss: null,
      };
    }

    const { estimateQuery, invoiceQuery, paymentQuery } = this.buildTxnQueries(
      [jobId],
      true,
    );

    const [estimatesResp, invoicesResp, paymentsResp, purchases, plReport] =
      await Promise.all([
        this.apiService.query(
          effectiveRealmId,
          estimateQuery,
        ) as Promise<QboEstimateResponse>,
        this.apiService.query(
          effectiveRealmId,
          invoiceQuery,
        ) as Promise<QboInvoiceResponse>,
        this.apiService.query(
          effectiveRealmId,
          paymentQuery!,
        ) as Promise<QboPaymentResponse>,
        this.apiService.queryAll(effectiveRealmId, 'Purchase') as Promise<
          Record<string, unknown>[]
        >,
        this.apiService.report(effectiveRealmId, 'ProfitAndLoss', {
          customer: jobId,
        }),
      ]);

    const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const payments = paymentsResp?.QueryResponse?.Payment ?? [];
    const projectPurchases = purchases.filter((purchase) =>
      this.transactionMatchesProject(
        this.normalizer.normalizePurchase(purchase),
        jobId,
        projectNumber,
        jobObject?.DisplayName,
      ),
    );
    const attachmentEntityRefs = this.buildAttachmentEntityRefs(
      jobId,
      estimates,
      invoices,
      payments,
      projectPurchases,
    );
    const attachables = await this.getAttachablesForEntityRefs(
      effectiveRealmId,
      attachmentEntityRefs,
    );
    const attachmentsByEntity = this.groupAttachablesByEntity(attachables);

    const estTotal = estimates.reduce(
      (s, e) => s + (Number(e.TotalAmt) || 0),
      0,
    );
    const invTotal = invoices.reduce(
      (s, i) => s + (Number(i.TotalAmt) || 0),
      0,
    );
    const outstanding = invoices.reduce(
      (s, i) => s + (Number(i.Balance) || 0),
      0,
    );
    const paidAmount = invTotal - outstanding;

    return {
      projectNumber,
      found: true,
      job: jobObject,
      financials: {
        estimatedAmount: estTotal,
        estimateCount: estimates.length,
        invoicedAmount: invTotal,
        invoiceCount: invoices.length,
        paidAmount,
        outstandingAmount: outstanding,
        paidPercentage:
          invTotal > 0 ? Math.round((paidAmount / invTotal) * 10000) / 100 : 0,
        estimateVsInvoicedDelta: estTotal - invTotal,
      },
      estimates: estimates.map((estimate) =>
        this.normalizer.normalizeEstimate(
          estimate,
          this.attachmentsForEntity(
            attachmentsByEntity,
            'Estimate',
            estimate.Id,
          ),
        ),
      ),
      invoices: invoices.map((invoice) =>
        this.normalizer.normalizeInvoice(
          invoice,
          this.attachmentsForEntity(attachmentsByEntity, 'Invoice', invoice.Id),
        ),
      ),
      payments: payments.map((payment) =>
        this.normalizer.normalizePayment(
          payment,
          this.attachmentsForEntity(
            attachmentsByEntity,
            'Payment',
            payment['Id'],
          ),
        ),
      ),
      expenses: projectPurchases.map((purchase) =>
        this.normalizer.normalizePurchase(
          purchase,
          this.attachmentsForEntity(
            attachmentsByEntity,
            'Purchase',
            purchase['Id'],
          ),
        ),
      ),
      attachments: attachables.map((attachment) =>
        this.normalizer.normalizeAttachable(attachment),
      ),
      profitAndLoss: this.parseProfitAndLoss(
        projectNumber,
        jobId,
        plReport as Record<string, unknown>,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Shared private helpers
  // ---------------------------------------------------------------------------

  /** Returns the realmId of the first stored QBO connection. Used by the MCP proxy tools. */
  async getDefaultRealmId(): Promise<string> {
    return this.resolveDefaultRealmId();
  }

  /** Convenience wrapper for single-project lookups. */
  private async resolveSingleJob(
    projectNumber: string,
    realmId: string,
  ): Promise<{ jobId: string | null; jobObject: QboCustomer | null }> {
    const ctx = await this.resolveJobs(realmId, [projectNumber]);
    return {
      jobId: ctx.jobMap[projectNumber] ?? null,
      jobObject: ctx.jobObjectMap[projectNumber] ?? null,
    };
  }

  private async resolveDefaultRealmId(): Promise<string> {
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
  }

  private transactionMatchesProject(
    txn: QboNormalizedTransaction,
    jobId: string,
    projectNumber: string,
    jobDisplayName?: string,
  ): boolean {
    return txn.projectRefs.some((ref) =>
      this.projectRefMatches(ref, jobId, projectNumber, jobDisplayName),
    );
  }

  private projectRefMatches(
    ref: QboRef,
    jobId: string,
    projectNumber: string,
    jobDisplayName?: string,
  ): boolean {
    if (ref.value) return ref.value === jobId;
    const name = String(ref.name ?? '').trim();
    if (!name) return false;
    return (
      name === jobDisplayName ||
      name === projectNumber ||
      name.split(',')[0].trim() === projectNumber
    );
  }

  private async getProjectRelatedEntityRefs(
    realmId: string,
    projectNumber: string,
    jobId: string,
    jobDisplayName?: string,
  ): Promise<AttachmentEntityRef[]> {
    const escapedJobId = this.apiService.escapeQboString(jobId);
    const [estimates, invoices, payments, purchases] = await Promise.all([
      this.apiService.queryAll(realmId, 'Estimate', {
        where: `CustomerRef IN ('${escapedJobId}')`,
      }) as Promise<Record<string, unknown>[]>,
      this.apiService.queryAll(realmId, 'Invoice', {
        where: `CustomerRef IN ('${escapedJobId}')`,
      }) as Promise<Record<string, unknown>[]>,
      this.apiService.queryAll(realmId, 'Payment', {
        where: `CustomerRef IN ('${escapedJobId}')`,
      }) as Promise<Record<string, unknown>[]>,
      this.apiService.queryAll(realmId, 'Purchase') as Promise<
        Record<string, unknown>[]
      >,
    ]);

    const projectPurchases = purchases.filter((purchase) =>
      this.transactionMatchesProject(
        this.normalizer.normalizePurchase(purchase),
        jobId,
        projectNumber,
        jobDisplayName,
      ),
    );

    return this.buildAttachmentEntityRefs(
      jobId,
      estimates,
      invoices,
      payments,
      projectPurchases,
    );
  }

  private buildAttachmentEntityRefs(
    jobId: string,
    estimates: Array<{ Id?: unknown }>,
    invoices: Array<{ Id?: unknown }>,
    payments: Array<{ Id?: unknown }>,
    purchases: Array<{ Id?: unknown }>,
  ): AttachmentEntityRef[] {
    const refs: AttachmentEntityRef[] = [
      { entityType: 'Customer', entityId: jobId },
    ];

    for (const estimate of estimates)
      refs.push(this.entityRef('Estimate', estimate.Id));
    for (const invoice of invoices)
      refs.push(this.entityRef('Invoice', invoice.Id));
    for (const payment of payments)
      refs.push(this.entityRef('Payment', payment.Id));
    for (const purchase of purchases)
      refs.push(this.entityRef('Purchase', purchase.Id));

    return refs.filter((ref) => ref.entityId);
  }

  private entityRef(
    entityType: string,
    entityId: unknown,
  ): AttachmentEntityRef {
    return { entityType, entityId: this.stringValue(entityId) };
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

  private async getAttachablesForEntityRefs(
    realmId: string,
    refs: AttachmentEntityRef[],
  ): Promise<Record<string, unknown>[]> {
    const uniqueRefs = new Map<string, AttachmentEntityRef>();
    for (const ref of refs) {
      if (!ref.entityId || !ref.entityType) continue;
      uniqueRefs.set(`${ref.entityType}:${ref.entityId}`, ref);
    }

    const pages = await Promise.all(
      [...uniqueRefs.values()].map((ref) => {
        const entityType = this.apiService.escapeQboString(ref.entityType);
        const entityId = this.apiService.escapeQboString(ref.entityId);
        return this.apiService.queryAll(realmId, 'Attachable', {
          where:
            `AttachableRef.EntityRef.Type = '${entityType}' ` +
            `AND AttachableRef.EntityRef.Value = '${entityId}'`,
        }) as Promise<Record<string, unknown>[]>;
      }),
    );

    const byId = new Map<string, Record<string, unknown>>();
    for (const attachment of pages.flat()) {
      const id = this.stringValue(attachment['Id']);
      byId.set(id || `${byId.size}`, attachment);
    }
    return [...byId.values()];
  }

  private groupAttachablesByEntity(
    attachables: Record<string, unknown>[],
  ): Map<string, Record<string, unknown>[]> {
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const attachment of attachables) {
      const refs = this.normalizer.normalizeAttachable(attachment).entityRefs;
      for (const ref of refs) {
        const key = `${ref.entityType}:${ref.entityId}`;
        grouped.set(key, [...(grouped.get(key) ?? []), attachment]);
      }
    }
    return grouped;
  }

  private attachmentsForEntity(
    grouped: Map<string, Record<string, unknown>[]>,
    entityType: string,
    entityId: unknown,
  ): Record<string, unknown>[] {
    return grouped.get(`${entityType}:${this.stringValue(entityId)}`) ?? [];
  }

  private deduplicateProjectNumbers(raw: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const pn of raw) {
      const trimmed = String(pn ?? '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  /**
   * Finds QBO sub-customers (Jobs) matching the given project numbers and
   * returns a lookup context used by both public methods.
   *
   * QBO does not support OR in WHERE, so for multiple project numbers we
   * fetch all Jobs and filter client-side. For a single number a LIKE is used.
   */
  private async resolveJobs(
    realmId: string,
    projectNumbers: string[],
  ): Promise<JobContext> {
    const customerQuery =
      projectNumbers.length === 1
        ? `SELECT * FROM Customer WHERE Job = true AND DisplayName LIKE '${projectNumbers[0].replace(/'/g, "''")},%' STARTPOSITION 1 MAXRESULTS 1000`
        : `SELECT * FROM Customer WHERE Job = true STARTPOSITION 1 MAXRESULTS 1000`;

    const resp = (await this.apiService.query(
      realmId,
      customerQuery,
    )) as QboCustomerResponse;

    const customers = resp?.QueryResponse?.Customer ?? [];
    const wantedSet = new Set(projectNumbers);

    const jobMap: Record<string, string> = {};
    const jobObjectMap: Record<string, QboCustomer> = {};

    for (const c of customers) {
      const dn = String(c.DisplayName ?? '').trim();
      if (!dn) continue;
      const pn = dn.split(',')[0].trim();
      if (!pn || !wantedSet.has(pn)) continue;
      jobMap[pn] = String(c.Id);
      jobObjectMap[pn] = c;
    }

    const jobIds = [...new Set(Object.values(jobMap))];
    return { jobMap, jobObjectMap, jobIds };
  }

  /**
   * @param full  true → SELECT * (includes line items); false → minimal fields only
   */
  private buildTxnQueries(
    jobIds: string[],
    includePayments: boolean,
  ): { estimateQuery: string; invoiceQuery: string; paymentQuery?: string } {
    const inList = jobIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(',');
    const where = `CustomerRef IN (${inList})`;

    return {
      estimateQuery: `SELECT * FROM Estimate WHERE ${where} STARTPOSITION 1 MAXRESULTS 1000`,
      invoiceQuery: `SELECT * FROM Invoice WHERE ${where} STARTPOSITION 1 MAXRESULTS 1000`,
      ...(includePayments && {
        paymentQuery: `SELECT * FROM Payment WHERE CustomerRef IN (${inList}) STARTPOSITION 1 MAXRESULTS 1000`,
      }),
    };
  }

  private aggregateFinancials(
    projectNumbers: string[],
    jobMap: Record<string, string>,
    estimatesResp: QboEstimateResponse,
    invoicesResp: QboInvoiceResponse,
  ): ProjectFinancials[] {
    const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];

    const estByJob: Record<string, { amount: number; count: number }> = {};
    for (const e of estimates) {
      const id = this.extractCustomerRefId(e.CustomerRef);
      if (!id) continue;
      if (!estByJob[id]) estByJob[id] = { amount: 0, count: 0 };
      estByJob[id].amount += Number(e.TotalAmt) || 0;
      estByJob[id].count += 1;
    }

    const invByJob: Record<
      string,
      { amount: number; count: number; outstanding: number }
    > = {};
    for (const i of invoices) {
      const id = this.extractCustomerRefId(i.CustomerRef);
      if (!id) continue;
      if (!invByJob[id]) invByJob[id] = { amount: 0, count: 0, outstanding: 0 };
      invByJob[id].amount += Number(i.TotalAmt) || 0;
      invByJob[id].outstanding += Number(i.Balance) || 0;
      invByJob[id].count += 1;
    }

    return projectNumbers.map((pn) => {
      const jobId = jobMap[pn];
      if (!jobId) return this.emptyFinancials(pn);

      const est = estByJob[jobId] ?? { amount: 0, count: 0 };
      const inv = invByJob[jobId] ?? { amount: 0, count: 0, outstanding: 0 };
      const paidAmount = inv.amount - inv.outstanding;
      const paidPercentage =
        inv.amount > 0 ? (paidAmount / inv.amount) * 100 : 0;

      return {
        projectNumber: pn,
        found: true,
        estimatedAmount: est.amount,
        estimateCount: est.count,
        invoicedAmount: inv.amount,
        invoiceCount: inv.count,
        paidAmount,
        outstandingAmount: inv.outstanding,
        paidPercentage: Math.round(paidPercentage * 100) / 100,
        estimateVsInvoicedDelta: est.amount - inv.amount,
      };
    });
  }

  /** Groups an array of QBO transactions by their CustomerRef value. */
  private indexByJobId<T extends { CustomerRef?: unknown }>(
    items: T[],
  ): Record<string, T[]> {
    const index: Record<string, T[]> = {};
    for (const item of items) {
      const id = this.extractCustomerRefId(
        item.CustomerRef as QboTxnBase['CustomerRef'],
      );
      if (!id) continue;
      if (!index[id]) index[id] = [];
      index[id].push(item);
    }
    return index;
  }

  private extractCustomerRefId(
    ref: QboTxnBase['CustomerRef'] | undefined,
  ): string {
    if (!ref) return '';
    if (typeof ref === 'object' && 'value' in ref) return String(ref.value);
    return String(ref);
  }

  private emptyFinancials(projectNumber: string): ProjectFinancials {
    return {
      projectNumber,
      found: false,
      estimatedAmount: 0,
      estimateCount: 0,
      invoicedAmount: 0,
      invoiceCount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      paidPercentage: 0,
      estimateVsInvoicedDelta: 0,
    };
  }

  private emptyDetail(projectNumber: string): ProjectDetail {
    return {
      projectNumber,
      found: false,
      job: null,
      financials: {
        estimatedAmount: 0,
        estimateCount: 0,
        invoicedAmount: 0,
        invoiceCount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        paidPercentage: 0,
        estimateVsInvoicedDelta: 0,
      },
      estimates: [],
      invoices: [],
      payments: [],
    };
  }

  private parseProfitAndLoss(
    projectNumber: string,
    customerId: string,
    report: Record<string, unknown>,
  ): ProjectProfitAndLoss {
    const rows =
      ((report['Rows'] as Record<string, unknown>)?.['Row'] as Record<
        string,
        unknown
      >[]) ?? [];

    const result: ProjectProfitAndLoss = {
      projectNumber,
      found: true,
      customerId,
      income: { total: 0, categories: [] },
      costOfGoodsSold: { total: 0, categories: [] },
      expenses: { total: 0, categories: [] },
      grossProfit: 0,
      netProfit: 0,
    };

    for (const row of rows) {
      const group = this.stringValue(row['group']);
      const summary = row['Summary'] as Record<string, unknown>;
      const summaryData =
        (summary?.['ColData'] as Record<string, unknown>[]) ?? [];
      const totalVal = Number(summaryData[1]?.['value']) || 0;
      const innerRows =
        ((row['Rows'] as Record<string, unknown>)?.['Row'] as Record<
          string,
          unknown
        >[]) ?? [];

      const categories: PnlCategory[] = innerRows
        .filter((r) => r['type'] === 'Data')
        .map((r) => {
          const colData = (r['ColData'] as Record<string, unknown>[]) ?? [];
          return {
            name: this.stringValue(colData[0]?.['value']),
            amount: Number(colData[1]?.['value']) || 0,
          };
        });

      if (group === 'Income') result.income = { total: totalVal, categories };
      else if (group === 'COGS')
        result.costOfGoodsSold = { total: totalVal, categories };
      else if (group === 'Expenses')
        result.expenses = { total: totalVal, categories };
      else if (group === 'NetIncome') result.netProfit = totalVal;
    }

    result.grossProfit = result.income.total - result.costOfGoodsSold.total;
    return result;
  }
}
