import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../entities/qbo-connection.entity';
import { QuickbooksApiService } from './quickbooks-api.service';
import { QboReauthorizationRequiredException } from '../exceptions/qbo-reauthorization-required.exception';

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

export interface InvoiceSummary {
  invoiceId: string;
  invoiceNumber: string;
  txnDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  /** Derived: Paid | Partial | Overdue | Pending */
  status: string;
  customerName: string;
}

export interface UnbilledWorkResult {
  projectNumber: string;
  found: boolean;
  job: Record<string, unknown> | null;
  totalEstimated: number;
  totalInvoiced: number;
  /** totalEstimated − totalInvoiced */
  unbilledAmount: number;
  /** Full QBO Estimate objects with line items */
  estimates: unknown[];
  /** Full QBO Invoice objects with line items */
  invoices: unknown[];
}

export interface ProjectDetail {
  projectNumber: string;
  /** false when the project number was not found as a QBO job */
  found: boolean;
  /** QBO sub-customer (Job) record — null when not found */
  job: Record<string, unknown> | null;
  /** Aggregated financial summary */
  financials: Omit<ProjectFinancials, 'projectNumber' | 'found'>;
  /** Full QBO Estimate objects including line items */
  estimates: Record<string, unknown>[];
  /** Full QBO Invoice objects including line items */
  invoices: Record<string, unknown>[];
  /** Full QBO Payment objects including linked transactions */
  payments: Record<string, unknown>[];
}

export interface ExpenseItem {
  expenseId: string;
  txnDate: string;
  vendorName: string;
  totalAmount: number;
  memo: string;
  /** Cash | CreditCard | Check */
  paymentType: string;
  lines: Array<{ amount: number; description: string; accountName: string }>;
}

export interface AttachmentItem {
  attachableId: string;
  fileName: string;
  fileSize: number | null;
  contentType: string;
  note: string;
  txnDate: string;
  downloadUrl: string | null;
}

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
  estimates: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
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

// ---------------------------------------------------------------------------

@Injectable()
export class QuickbooksFinancialsService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly apiService: QuickbooksApiService,
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
    if (!ctx.jobIds.length) return cleaned.map((pn) => this.emptyFinancials(pn));

    const { estimateQuery, invoiceQuery } = this.buildTxnQueries(ctx.jobIds, false);

    const [estimatesResp, invoicesResp] = await Promise.all([
      this.apiService.query(effectiveRealmId, estimateQuery) as Promise<QboEstimateResponse>,
      this.apiService.query(effectiveRealmId, invoiceQuery) as Promise<QboInvoiceResponse>,
    ]);

    return this.aggregateFinancials(cleaned, ctx.jobMap, estimatesResp, invoicesResp);
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

    // Fetch all transaction types in parallel — SELECT * returns full objects with line items
    const { estimateQuery, invoiceQuery, paymentQuery } = this.buildTxnQueries(
      ctx.jobIds,
      true,
    );

    const [estimatesResp, invoicesResp, paymentsResp] = await Promise.all([
      this.apiService.query(effectiveRealmId, estimateQuery) as Promise<QboEstimateResponse>,
      this.apiService.query(effectiveRealmId, invoiceQuery) as Promise<QboInvoiceResponse>,
      this.apiService.query(effectiveRealmId, paymentQuery!) as Promise<QboPaymentResponse>,
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
      const estTotal = projEstimates.reduce((s, e) => s + (Number(e.TotalAmt) || 0), 0);
      const invTotal = projInvoices.reduce((s, i) => s + (Number(i.TotalAmt) || 0), 0);
      const outstanding = projInvoices.reduce((s, i) => s + (Number(i.Balance) || 0), 0);
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
        estimates: projEstimates as Record<string, unknown>[],
        invoices: projInvoices as Record<string, unknown>[],
        payments: projPayments,
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
    const { jobId } = await this.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Invoice WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Invoice?: QboInvoice[] } };

    const invoices = resp?.QueryResponse?.Invoice ?? [];
    const today = new Date();

    return invoices.map((inv) => {
      const total = Number(inv.TotalAmt) || 0;
      const balance = Number(inv.Balance) || 0;
      const paid = total - balance;
      const dueDate = inv.DueDate ? new Date(inv.DueDate as string) : null;
      let status: string;
      if (balance === 0) status = 'Paid';
      else if (paid > 0) status = 'Partial';
      else if (dueDate && dueDate < today) status = 'Overdue';
      else status = 'Pending';

      return {
        invoiceId: String(inv.Id),
        invoiceNumber: String((inv as Record<string, unknown>).DocNumber ?? ''),
        txnDate: String((inv as Record<string, unknown>).TxnDate ?? ''),
        dueDate: String((inv as Record<string, unknown>).DueDate ?? ''),
        totalAmount: total,
        paidAmount: paid,
        balance,
        status,
        customerName: this.customerRefName(inv.CustomerRef),
      };
    });
  }

  /** Full Invoice object with line items fetched directly by QBO invoice ID. */
  async getInvoiceById(
    invoiceId: string,
    realmId?: string,
  ): Promise<unknown> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    return this.apiService.getById(effectiveRealmId, 'invoice', invoiceId);
  }

  /** All Estimates for a project — full objects including line items. */
  async getEstimatesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<unknown[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Estimate WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Estimate?: unknown[] } };

    return resp?.QueryResponse?.Estimate ?? [];
  }

  /** Full Estimate object with line items fetched directly by QBO estimate ID. */
  async getEstimateById(
    estimateId: string,
    realmId?: string,
  ): Promise<unknown> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    return this.apiService.getById(effectiveRealmId, 'estimate', estimateId);
  }

  /** All Payments for a project with date, method, and linked invoices. */
  async getPaymentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<unknown[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Payment WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Payment?: unknown[] } };

    return resp?.QueryResponse?.Payment ?? [];
  }

  /**
   * Returns the unbilled work breakdown for a project:
   * total estimated − total invoiced, with full estimate and invoice objects
   * so the caller can compare line items.
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
      estimates: estimates as unknown[],
      invoices: invoices as unknown[],
    };
  }

  /** All vendor expenses (Purchases) charged against a project in QuickBooks. */
  async getExpensesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<ExpenseItem[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Purchase WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Purchase?: Record<string, unknown>[] } };

    return (resp?.QueryResponse?.Purchase ?? []).map((p) => this.mapExpense(p));
  }

  /** Files and documents attached to a QuickBooks project (job). */
  async getAttachmentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<AttachmentItem[]> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = 'Customer' AND AttachableRef.EntityRef.Value = '${jobId}' STARTPOSITION 1 MAXRESULTS 100`,
    )) as { QueryResponse?: { Attachable?: Record<string, unknown>[] } };

    return (resp?.QueryResponse?.Attachable ?? []).map((a) => this.mapAttachment(a));
  }

  /** QuickBooks Profit & Loss report for a specific project, broken down by category. */
  async getProjectProfitAndLoss(
    projectNumber: string,
    realmId?: string,
  ): Promise<ProjectProfitAndLoss> {
    const effectiveRealmId = realmId ?? (await this.resolveDefaultRealmId());
    const { jobId } = await this.resolveSingleJob(projectNumber, effectiveRealmId);

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
    const { jobId, jobObject } = await this.resolveSingleJob(projectNumber, effectiveRealmId);

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

    const { estimateQuery, invoiceQuery, paymentQuery } = this.buildTxnQueries([jobId], true);

    const [estimatesResp, invoicesResp, paymentsResp, purchasesResp, attachablesResp, plReport] =
      await Promise.all([
        this.apiService.query(effectiveRealmId, estimateQuery) as Promise<QboEstimateResponse>,
        this.apiService.query(effectiveRealmId, invoiceQuery) as Promise<QboInvoiceResponse>,
        this.apiService.query(effectiveRealmId, paymentQuery!) as Promise<QboPaymentResponse>,
        this.apiService.query(
          effectiveRealmId,
          `SELECT * FROM Purchase WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
        ) as Promise<{ QueryResponse?: { Purchase?: Record<string, unknown>[] } }>,
        this.apiService.query(
          effectiveRealmId,
          `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = 'Customer' AND AttachableRef.EntityRef.Value = '${jobId}' STARTPOSITION 1 MAXRESULTS 100`,
        ) as Promise<{ QueryResponse?: { Attachable?: Record<string, unknown>[] } }>,
        this.apiService.report(effectiveRealmId, 'ProfitAndLoss', { customer: jobId }),
      ]);

    const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const payments = paymentsResp?.QueryResponse?.Payment ?? [];
    const purchases = purchasesResp?.QueryResponse?.Purchase ?? [];
    const attachables = attachablesResp?.QueryResponse?.Attachable ?? [];

    const estTotal = estimates.reduce((s, e) => s + (Number(e.TotalAmt) || 0), 0);
    const invTotal = invoices.reduce((s, i) => s + (Number(i.TotalAmt) || 0), 0);
    const outstanding = invoices.reduce((s, i) => s + (Number((i as QboInvoice).Balance) || 0), 0);
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
        paidPercentage: invTotal > 0 ? Math.round((paidAmount / invTotal) * 10000) / 100 : 0,
        estimateVsInvoicedDelta: estTotal - invTotal,
      },
      estimates: estimates as Record<string, unknown>[],
      invoices: invoices as Record<string, unknown>[],
      payments,
      expenses: purchases.map((p) => this.mapExpense(p)),
      attachments: attachables.map((a) => this.mapAttachment(a)),
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

  private customerRefName(
    ref: QboTxnBase['CustomerRef'] | undefined,
  ): string {
    if (!ref) return '';
    if (typeof ref === 'object' && 'name' in ref) return String(ref.name ?? '');
    return '';
  }

  private async resolveDefaultRealmId(): Promise<string> {
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
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
    full: boolean,
  ): { estimateQuery: string; invoiceQuery: string; paymentQuery?: string } {
    const inList = jobIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(',');
    const where = `CustomerRef IN (${inList})`;
    const fields = full ? '*' : 'Id, TotalAmt, CustomerRef';
    const invoiceFields = full ? '*' : 'Id, TotalAmt, Balance, CustomerRef';

    return {
      estimateQuery: `SELECT ${fields} FROM Estimate WHERE ${where} STARTPOSITION 1 MAXRESULTS 1000`,
      invoiceQuery: `SELECT ${invoiceFields} FROM Invoice WHERE ${where} STARTPOSITION 1 MAXRESULTS 1000`,
      ...(full && {
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

    const invByJob: Record<string, { amount: number; count: number; outstanding: number }> = {};
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
      const paidPercentage = inv.amount > 0 ? (paidAmount / inv.amount) * 100 : 0;

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
      const id = this.extractCustomerRefId(item.CustomerRef as QboTxnBase['CustomerRef']);
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

  private mapExpense(p: Record<string, unknown>): ExpenseItem {
    const lines = ((p['Line'] as Record<string, unknown>[]) ?? [])
      .filter((l) => l['DetailType'] === 'AccountBasedExpenseLineDetail')
      .map((l) => {
        const detail = (l['AccountBasedExpenseLineDetail'] as Record<string, unknown>) ?? {};
        const account = (detail['AccountRef'] as Record<string, unknown>) ?? {};
        return {
          amount: Number(l['Amount']) || 0,
          description: String(l['Description'] ?? ''),
          accountName: String(account['name'] ?? ''),
        };
      });

    const entityRef = (p['EntityRef'] as Record<string, unknown>) ?? {};
    return {
      expenseId: String(p['Id'] ?? ''),
      txnDate: String(p['TxnDate'] ?? ''),
      vendorName: String(entityRef['name'] ?? ''),
      totalAmount: Number(p['TotalAmt']) || 0,
      memo: String(p['PrivateNote'] ?? p['Memo'] ?? ''),
      paymentType: String(p['PaymentType'] ?? ''),
      lines,
    };
  }

  private mapAttachment(a: Record<string, unknown>): AttachmentItem {
    return {
      attachableId: String(a['Id'] ?? ''),
      fileName: String(a['FileName'] ?? ''),
      fileSize: a['Size'] != null ? Number(a['Size']) : null,
      contentType: String(a['ContentType'] ?? ''),
      note: String(a['Note'] ?? ''),
      txnDate: String(a['TxnDate'] ?? ''),
      downloadUrl: a['TempDownloadUri'] ? String(a['TempDownloadUri']) : null,
    };
  }

  private parseProfitAndLoss(
    projectNumber: string,
    customerId: string,
    report: Record<string, unknown>,
  ): ProjectProfitAndLoss {
    const rows =
      ((report['Rows'] as Record<string, unknown>)?.['Row'] as Record<string, unknown>[]) ?? [];

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
      const group = String(row['group'] ?? '');
      const summary = row['Summary'] as Record<string, unknown>;
      const summaryData = (summary?.['ColData'] as Record<string, unknown>[]) ?? [];
      const totalVal = Number(summaryData[1]?.['value']) || 0;
      const innerRows =
        ((row['Rows'] as Record<string, unknown>)?.['Row'] as Record<string, unknown>[]) ?? [];

      const categories: PnlCategory[] = innerRows
        .filter((r) => r['type'] === 'Data')
        .map((r) => {
          const colData = (r['ColData'] as Record<string, unknown>[]) ?? [];
          return {
            name: String(colData[0]?.['value'] ?? ''),
            amount: Number(colData[1]?.['value']) || 0,
          };
        });

      if (group === 'Income') result.income = { total: totalVal, categories };
      else if (group === 'COGS') result.costOfGoodsSold = { total: totalVal, categories };
      else if (group === 'Expenses') result.expenses = { total: totalVal, categories };
      else if (group === 'NetIncome') result.netProfit = totalVal;
    }

    result.grossProfit = result.income.total - result.costOfGoodsSold.total;
    return result;
  }
}
