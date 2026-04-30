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
  // Public methods
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
  // Shared private helpers
  // ---------------------------------------------------------------------------

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
}
