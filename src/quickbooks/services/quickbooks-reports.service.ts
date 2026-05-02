import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../entities/qbo-connection.entity';
import { QuickbooksApiService } from './quickbooks-api.service';
import { QboReauthorizationRequiredException } from '../exceptions/qbo-reauthorization-required.exception';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AgingInvoiceItem {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  projectNumber: string | null;
  txnDate: string;
  dueDate: string;
  totalAmount: number;
  balance: number;
  daysOverdue: number;
}

export interface AgingBucket {
  invoices: AgingInvoiceItem[];
  totalBalance: number;
  count: number;
}

export interface AgingReport {
  asOf: string;
  current: AgingBucket;
  days1to30: AgingBucket;
  days31to60: AgingBucket;
  days61to90: AgingBucket;
  over90: AgingBucket;
  totalOutstanding: number;
}

export interface OutstandingBalanceItem {
  jobId: string;
  customerName: string;
  projectNumber: string | null;
  totalInvoiced: number;
  totalOutstanding: number;
  invoiceCount: number;
  oldestInvoiceDate: string | null;
}

export interface RevenueByPeriodResult {
  period: { start: string; end: string };
  totalRevenue: number;
  paymentCount: number;
  payments: unknown[];
}

export interface BacklogItem {
  jobId: string;
  customerName: string;
  projectNumber: string | null;
  estimatedAmount: number;
  invoicedAmount: number;
  /** estimatedAmount − invoicedAmount */
  backlogAmount: number;
  estimateCount: number;
  invoiceCount: number;
}

export interface FinancialSearchCriteria {
  minOutstanding?: number;
  maxOutstanding?: number;
  minInvoiced?: number;
  maxInvoiced?: number;
  minEstimated?: number;
  /** Return only projects where estimated > invoiced */
  hasUnbilledWork?: boolean;
  minUnbilledAmount?: number;
}

export interface FinancialSearchResult {
  jobId: string;
  customerName: string;
  projectNumber: string | null;
  estimatedAmount: number;
  invoicedAmount: number;
  outstandingBalance: number;
  unbilledAmount: number;
}

export interface ClientRevenueItem {
  jobId: string;
  customerName: string;
  projectNumber: string | null;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
}

// ---------------------------------------------------------------------------
// Phase 5 — report types
// ---------------------------------------------------------------------------

export interface ReportParams {
  realmId?: string;
  startDate: string;
  endDate: string;
  customerId?: string;
  vendorId?: string;
  accountingMethod?: 'Cash' | 'Accrual';
  summarizeColumnBy?: string;
  includeRaw?: boolean;
}

export interface DateChunk {
  start: string;
  end: string;
}

export interface ReportCoverage {
  start: string;
  end: string;
  dateChunks: DateChunk[];
}

export interface ReportRow {
  reportName: string;
  section: string;
  group: string;
  label: string;
  columns: Record<string, string>;
  amount: number;
  entityId?: string;
  depth: number;
  path: string[];
}

export interface ParsedReport {
  reportName: string;
  rows: ReportRow[];
  summary: Record<string, number>;
  coverage: ReportCoverage;
  raw?: unknown;
}

export interface ProjectReportBundle {
  customerId?: string;
  profitAndLoss: ParsedReport;
  profitAndLossDetail: ParsedReport;
  vendorExpenses: ParsedReport;
  agedPayables: ParsedReport;
  vendorBalanceDetail: ParsedReport;
  generalLedgerDetail?: ParsedReport;
  warnings: string[];
  coverage: ReportCoverage;
}

// ---------------------------------------------------------------------------
// Standalone utility functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Splits a date range into chunks of at most 6 months each.
 * Returns the original single chunk when the range is ≤ 6 months.
 */
export function splitDateRange(start: string, end: string): DateChunk[] {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return [];

  const chunks: DateChunk[] = [];
  let chunkStart = new Date(startMs);
  const endDate = new Date(endMs);

  while (chunkStart <= endDate) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + 6);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() - 1);

    const actualEnd = chunkEnd <= endDate ? chunkEnd : endDate;
    chunks.push({
      start: chunkStart.toISOString().slice(0, 10),
      end: actualEnd.toISOString().slice(0, 10),
    });

    chunkStart = new Date(actualEnd);
    chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
  }

  return chunks;
}

/** Extracts ordered column titles from a raw QBO report object. */
export function extractColumnTitles(rawReport: unknown): string[] {
  const report = rawReport as Record<string, unknown>;
  const cols = (report?.['Columns'] as Record<string, unknown>)?.['Column'];
  if (!Array.isArray(cols)) return [];
  return (cols as Record<string, unknown>[]).map((c) =>
    String(c?.['ColTitle'] ?? ''),
  );
}

/**
 * Parses a raw QBO report response into flat rows.
 * Recurses into Section rows, preserving section / group / depth / path context.
 */
export function parseQboReportRows(
  reportName: string,
  rawReport: unknown,
): ReportRow[] {
  const report = rawReport as Record<string, unknown>;
  const columnTitles = extractColumnTitles(rawReport);
  const topRows =
    ((report?.['Rows'] as Record<string, unknown>)?.['Row'] as unknown[]) ?? [];
  const output: ReportRow[] = [];
  walkQboRows(reportName, topRows, columnTitles, output, '', '', 0, []);
  return output;
}

function walkQboRows(
  reportName: string,
  rows: unknown[],
  columnTitles: string[],
  output: ReportRow[],
  currentSection: string,
  currentGroup: string,
  depth: number,
  path: string[],
): void {
  for (const rawRow of rows) {
    const row = rawRow as Record<string, unknown>;
    const rowType = String(row['type'] ?? '');
    const rowGroup = String(row['group'] ?? '') || currentGroup;

    if (rowType === 'Section') {
      const header = row['Header'] as Record<string, unknown> | undefined;
      const headerData =
        (header?.['ColData'] as Record<string, unknown>[]) ?? [];
      const sectionLabel = String(headerData[0]?.['value'] ?? '');
      const newSection = sectionLabel || currentSection;
      const newPath = sectionLabel ? [...path, sectionLabel] : [...path];

      const nested =
        ((row['Rows'] as Record<string, unknown>)?.['Row'] as unknown[]) ?? [];
      walkQboRows(
        reportName,
        nested,
        columnTitles,
        output,
        newSection,
        rowGroup,
        depth + 1,
        newPath,
      );

      const summaryRaw = row['Summary'] as Record<string, unknown> | undefined;
      if (summaryRaw) {
        const colData =
          (summaryRaw['ColData'] as Record<string, unknown>[]) ?? [];
        if (colData.length) {
          output.push(
            buildQboRow(
              reportName,
              colData,
              columnTitles,
              newSection,
              rowGroup,
              depth,
              path,
            ),
          );
        }
      }
    } else {
      const colData = (row['ColData'] as Record<string, unknown>[]) ?? [];
      if (colData.length) {
        output.push(
          buildQboRow(
            reportName,
            colData,
            columnTitles,
            currentSection,
            currentGroup,
            depth,
            path,
          ),
        );
      }
    }
  }
}

function buildQboRow(
  reportName: string,
  colData: Record<string, unknown>[],
  columnTitles: string[],
  section: string,
  group: string,
  depth: number,
  path: string[],
): ReportRow {
  const first = colData[0] ?? {};
  const label = String(first['value'] ?? '');
  const entityIdRaw = String(first['id'] ?? '');

  const columns: Record<string, string> = {};
  let amount = 0;

  for (let i = 0; i < colData.length; i++) {
    const val = String(colData[i]?.['value'] ?? '');
    const title = columnTitles[i] || (i === 0 ? 'label' : `col_${i}`);
    columns[title] = val;
    if (i > 0) {
      const n = parseFloat(val.replace(/,/g, ''));
      if (!isNaN(n)) amount = n;
    }
  }

  const row: ReportRow = {
    reportName,
    section,
    group,
    label,
    columns,
    amount,
    depth,
    path: [...path],
  };
  if (entityIdRaw) row.entityId = entityIdRaw;
  return row;
}

/** Builds a summary map from flat rows: sums amount per "section:label" key. */
export function buildReportSummary(rows: ReportRow[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    if (!row.label) continue;
    const key = row.section ? `${row.section}:${row.label}` : row.label;
    summary[key] = (summary[key] ?? 0) + row.amount;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Internal QBO types
// ---------------------------------------------------------------------------

interface QboCustomer {
  Id: string;
  DisplayName: string;
  [key: string]: unknown;
}

interface QboInvoice {
  Id: string;
  TotalAmt: number;
  Balance: number;
  TxnDate?: string;
  DueDate?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string } | string;
  [key: string]: unknown;
}

interface QboEstimate {
  Id: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string } | string;
  [key: string]: unknown;
}

interface QboCustomerResponse {
  QueryResponse?: { Customer?: QboCustomer[] };
}

interface QboInvoiceResponse {
  QueryResponse?: { Invoice?: QboInvoice[] };
}

interface QboEstimateResponse {
  QueryResponse?: { Estimate?: QboEstimate[] };
}

interface QboPaymentResponse {
  QueryResponse?: { Payment?: Record<string, unknown>[] };
}

/** id → { customer, projectNumber } */
interface JobIndex {
  byId: Record<string, QboCustomer>;
  projectNumberById: Record<string, string | null>;
}

// ---------------------------------------------------------------------------

@Injectable()
export class QuickbooksReportsService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly apiService: QuickbooksApiService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public report methods
  // ---------------------------------------------------------------------------

  /**
   * Accounts receivable aging report.
   * Buckets open invoices by days overdue: current, 1-30, 31-60, 61-90, 90+.
   */
  async getAgingReport(realmId?: string): Promise<AgingReport> {
    const rid = realmId ?? (await this.resolveDefaultRealmId());

    const [jobIndex, invoicesResp] = await Promise.all([
      this.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets: AgingReport = {
      asOf: today.toISOString().split('T')[0],
      current: { invoices: [], totalBalance: 0, count: 0 },
      days1to30: { invoices: [], totalBalance: 0, count: 0 },
      days31to60: { invoices: [], totalBalance: 0, count: 0 },
      days61to90: { invoices: [], totalBalance: 0, count: 0 },
      over90: { invoices: [], totalBalance: 0, count: 0 },
      totalOutstanding: 0,
    };

    for (const inv of invoices) {
      const balance = Number(inv.Balance) || 0;
      if (!balance) continue;

      const jobId = this.refId(inv.CustomerRef);
      const dueStr = inv.DueDate ?? inv.TxnDate ?? '';
      const dueDate = dueStr ? new Date(dueStr) : null;
      const daysOverdue = dueDate
        ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000)
        : 0;

      const item: AgingInvoiceItem = {
        invoiceId: String(inv.Id),
        invoiceNumber: String(inv.DocNumber ?? ''),
        customerName: this.refName(inv.CustomerRef),
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        txnDate: String(inv.TxnDate ?? ''),
        dueDate: String(inv.DueDate ?? ''),
        totalAmount: Number(inv.TotalAmt) || 0,
        balance,
        daysOverdue: Math.max(0, daysOverdue),
      };

      let bucket: AgingBucket;
      if (daysOverdue <= 0) bucket = buckets.current;
      else if (daysOverdue <= 30) bucket = buckets.days1to30;
      else if (daysOverdue <= 60) bucket = buckets.days31to60;
      else if (daysOverdue <= 90) bucket = buckets.days61to90;
      else bucket = buckets.over90;

      bucket.invoices.push(item);
      bucket.totalBalance += balance;
      bucket.count += 1;
      buckets.totalOutstanding += balance;
    }

    return buckets;
  }

  /**
   * All QBO jobs (projects) with an open invoice balance, sorted by
   * outstanding balance descending.
   */
  async getOutstandingBalances(
    realmId?: string,
  ): Promise<OutstandingBalanceItem[]> {
    const rid = realmId ?? (await this.resolveDefaultRealmId());

    const [jobIndex, invoicesResp] = await Promise.all([
      this.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];

    const byJob: Record<
      string,
      { totalInvoiced: number; outstanding: number; count: number; oldest: string | null }
    > = {};

    for (const inv of invoices) {
      const jobId = this.refId(inv.CustomerRef);
      if (!jobId) continue;
      if (!byJob[jobId])
        byJob[jobId] = { totalInvoiced: 0, outstanding: 0, count: 0, oldest: null };
      byJob[jobId].totalInvoiced += Number(inv.TotalAmt) || 0;
      byJob[jobId].outstanding += Number(inv.Balance) || 0;
      byJob[jobId].count += 1;
      const txnDate = inv.TxnDate ?? null;
      if (txnDate && (!byJob[jobId].oldest || txnDate < byJob[jobId].oldest)) {
        byJob[jobId].oldest = txnDate;
      }
    }

    return Object.entries(byJob)
      .map(([jobId, agg]) => ({
        jobId,
        customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        totalInvoiced: agg.totalInvoiced,
        totalOutstanding: agg.outstanding,
        invoiceCount: agg.count,
        oldestInvoiceDate: agg.oldest,
      }))
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  /**
   * All QBO jobs that have more estimated than invoiced value — i.e., work
   * that has been quoted/contracted but not yet billed.
   */
  async getUnbilledCompletedWork(realmId?: string): Promise<BacklogItem[]> {
    return this.getBacklog(realmId);
  }

  /**
   * Revenue collected in a date range — sum of payments TxnDate ∈ [start, end].
   * Dates in YYYY-MM-DD format.
   */
  async getRevenueByPeriod(
    start: string,
    end: string,
    realmId?: string,
  ): Promise<RevenueByPeriodResult> {
    const rid = realmId ?? (await this.resolveDefaultRealmId());

    const resp = (await this.apiService.query(
      rid,
      `SELECT * FROM Payment WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION 1 MAXRESULTS 1000`,
    )) as QboPaymentResponse;

    const payments = resp?.QueryResponse?.Payment ?? [];
    const totalRevenue = payments.reduce(
      (s, p) => s + (Number(p['TotalAmt']) || 0),
      0,
    );

    return { period: { start, end }, totalRevenue, paymentCount: payments.length, payments };
  }

  /**
   * All jobs with contracted (estimated) work that exceeds what has been invoiced.
   * Positive backlogAmount = money earned but not yet billed.
   */
  async getBacklog(realmId?: string): Promise<BacklogItem[]> {
    const rid = realmId ?? (await this.resolveDefaultRealmId());

    const [jobIndex, estResp, invResp] = await Promise.all([
      this.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Estimate STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboEstimateResponse>,
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const estimates = estResp?.QueryResponse?.Estimate ?? [];
    const invoices = invResp?.QueryResponse?.Invoice ?? [];

    const estByJob: Record<string, { amount: number; count: number }> = {};
    for (const e of estimates) {
      const id = this.refId(e.CustomerRef);
      if (!id) continue;
      if (!estByJob[id]) estByJob[id] = { amount: 0, count: 0 };
      estByJob[id].amount += Number(e.TotalAmt) || 0;
      estByJob[id].count += 1;
    }

    const invByJob: Record<string, { amount: number; count: number }> = {};
    for (const i of invoices) {
      const id = this.refId(i.CustomerRef);
      if (!id) continue;
      if (!invByJob[id]) invByJob[id] = { amount: 0, count: 0 };
      invByJob[id].amount += Number(i.TotalAmt) || 0;
      invByJob[id].count += 1;
    }

    const allJobIds = new Set([
      ...Object.keys(estByJob),
      ...Object.keys(invByJob),
    ]);

    return [...allJobIds]
      .map((jobId) => {
        const est = estByJob[jobId] ?? { amount: 0, count: 0 };
        const inv = invByJob[jobId] ?? { amount: 0, count: 0 };
        return {
          jobId,
          customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
          projectNumber: jobIndex.projectNumberById[jobId] ?? null,
          estimatedAmount: est.amount,
          invoicedAmount: inv.amount,
          backlogAmount: est.amount - inv.amount,
          estimateCount: est.count,
          invoiceCount: inv.count,
        };
      })
      .filter((b) => b.backlogAmount > 0)
      .sort((a, b) => b.backlogAmount - a.backlogAmount);
  }

  /**
   * Flexible financial filter across all QBO jobs.
   * All criteria are optional — omitting all returns every job.
   */
  async searchByFinancialCriteria(
    criteria: FinancialSearchCriteria,
    realmId?: string,
  ): Promise<FinancialSearchResult[]> {
    const rid = realmId ?? (await this.resolveDefaultRealmId());

    const [jobIndex, estResp, invResp] = await Promise.all([
      this.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Estimate STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboEstimateResponse>,
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const estimates = estResp?.QueryResponse?.Estimate ?? [];
    const invoices = invResp?.QueryResponse?.Invoice ?? [];

    const estByJob: Record<string, number> = {};
    for (const e of estimates) {
      const id = this.refId(e.CustomerRef);
      if (!id) continue;
      estByJob[id] = (estByJob[id] ?? 0) + (Number(e.TotalAmt) || 0);
    }

    const invByJob: Record<string, { invoiced: number; outstanding: number }> = {};
    for (const i of invoices) {
      const id = this.refId(i.CustomerRef);
      if (!id) continue;
      if (!invByJob[id]) invByJob[id] = { invoiced: 0, outstanding: 0 };
      invByJob[id].invoiced += Number(i.TotalAmt) || 0;
      invByJob[id].outstanding += Number(i.Balance) || 0;
    }

    const allJobIds = new Set([
      ...Object.keys(estByJob),
      ...Object.keys(invByJob),
    ]);

    const results: FinancialSearchResult[] = [];

    for (const jobId of allJobIds) {
      const estimated = estByJob[jobId] ?? 0;
      const inv = invByJob[jobId] ?? { invoiced: 0, outstanding: 0 };
      const unbilled = estimated - inv.invoiced;

      const { minOutstanding, maxOutstanding, minInvoiced, maxInvoiced,
               minEstimated, hasUnbilledWork, minUnbilledAmount } = criteria;

      if (minOutstanding !== undefined && inv.outstanding < minOutstanding) continue;
      if (maxOutstanding !== undefined && inv.outstanding > maxOutstanding) continue;
      if (minInvoiced !== undefined && inv.invoiced < minInvoiced) continue;
      if (maxInvoiced !== undefined && inv.invoiced > maxInvoiced) continue;
      if (minEstimated !== undefined && estimated < minEstimated) continue;
      if (hasUnbilledWork === true && unbilled <= 0) continue;
      if (minUnbilledAmount !== undefined && unbilled < minUnbilledAmount) continue;

      results.push({
        jobId,
        customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        estimatedAmount: estimated,
        invoicedAmount: inv.invoiced,
        outstandingBalance: inv.outstanding,
        unbilledAmount: unbilled,
      });
    }

    return results.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  }

  /**
   * Top N clients by total invoiced amount, with paid vs outstanding breakdown.
   */
  async getTopClientsByRevenue(
    limit: number = 10,
    realmId?: string,
  ): Promise<ClientRevenueItem[]> {
    const rid = realmId ?? (await this.resolveDefaultRealmId());

    const [jobIndex, invoicesResp] = await Promise.all([
      this.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];

    const byJob: Record<
      string,
      { totalInvoiced: number; outstanding: number; count: number }
    > = {};

    for (const inv of invoices) {
      const jobId = this.refId(inv.CustomerRef);
      if (!jobId) continue;
      if (!byJob[jobId]) byJob[jobId] = { totalInvoiced: 0, outstanding: 0, count: 0 };
      byJob[jobId].totalInvoiced += Number(inv.TotalAmt) || 0;
      byJob[jobId].outstanding += Number(inv.Balance) || 0;
      byJob[jobId].count += 1;
    }

    return Object.entries(byJob)
      .map(([jobId, agg]) => ({
        jobId,
        customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        totalInvoiced: agg.totalInvoiced,
        totalPaid: agg.totalInvoiced - agg.outstanding,
        totalOutstanding: agg.outstanding,
        invoiceCount: agg.count,
      }))
      .sort((a, b) => b.totalInvoiced - a.totalInvoiced)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveDefaultRealmId(): Promise<string> {
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
  }

  /** Fetches all QBO Jobs and builds ID → Customer and ID → projectNumber maps. */
  private async buildJobIndex(realmId: string): Promise<JobIndex> {
    const resp = (await this.apiService.query(
      realmId,
      `SELECT * FROM Customer WHERE Job = true STARTPOSITION 1 MAXRESULTS 1000`,
    )) as QboCustomerResponse;

    const customers = resp?.QueryResponse?.Customer ?? [];
    const byId: Record<string, QboCustomer> = {};
    const projectNumberById: Record<string, string | null> = {};

    for (const c of customers) {
      const id = String(c.Id);
      byId[id] = c;
      const dn = String(c.DisplayName ?? '').trim();
      // DisplayName format: "ProjectNumber, CustomerName"
      const prefix = dn.split(',')[0].trim();
      projectNumberById[id] = prefix || null;
    }

    return { byId, projectNumberById };
  }

  private refId(ref: QboInvoice['CustomerRef'] | QboEstimate['CustomerRef']): string {
    if (!ref) return '';
    if (typeof ref === 'object' && 'value' in ref) return String(ref.value);
    return String(ref);
  }

  private refName(ref: QboInvoice['CustomerRef']): string {
    if (!ref) return '';
    if (typeof ref === 'object' && 'name' in ref) return String(ref.name ?? '');
    return '';
  }

  // ---------------------------------------------------------------------------
  // Phase 5: QBO financial report methods
  // ---------------------------------------------------------------------------

  async getProfitAndLossDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'ProfitAndLossDetail', params, {
      accounting_method: params.accountingMethod,
      ...(params.customerId && { customer: params.customerId }),
      ...(params.summarizeColumnBy && {
        summarize_column_by: params.summarizeColumnBy,
      }),
    }, true);
  }

  async getCashFlow(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'CashFlow', params, {
      accounting_method: params.accountingMethod,
      ...(params.summarizeColumnBy && {
        summarize_column_by: params.summarizeColumnBy,
      }),
    }, true);
  }

  async getVendorExpenses(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'VendorExpenses', params, {
      accounting_method: params.accountingMethod,
      ...(params.vendorId && { vendor: params.vendorId }),
    }, true);
  }

  async getVendorBalance(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'VendorBalance', params, {
      ...(params.vendorId && { vendor: params.vendorId }),
    }, false);
  }

  async getVendorBalanceDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'VendorBalanceDetail', params, {
      accounting_method: params.accountingMethod,
      ...(params.vendorId && { vendor: params.vendorId }),
    }, true);
  }

  async getAgedPayables(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'AgedPayables', params, {
      ...(params.vendorId && { vendor: params.vendorId }),
    }, false);
  }

  async getAgedPayableDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'AgedPayableDetail', params, {
      ...(params.vendorId && { vendor: params.vendorId }),
    }, false);
  }

  async getGeneralLedgerDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    return this.fetchAndParseReport(rid, 'GeneralLedger', params, {
      accounting_method: params.accountingMethod,
      ...(params.customerId && { customer: params.customerId }),
      ...(params.vendorId && { vendor: params.vendorId }),
    }, true);
  }

  /**
   * Fetches and returns a bundle of QBO report data relevant to a project:
   * P&L summary, P&L detail, vendor expenses, aged payables, vendor balance
   * detail, and optionally the general ledger. All reports are fetched in
   * parallel with automatic date-range splitting applied to each.
   */
  async getProjectReportBundle(
    params: ReportParams,
  ): Promise<ProjectReportBundle> {
    const rid = params.realmId ?? (await this.resolveDefaultRealmId());
    const p: ReportParams = { ...params, realmId: rid };
    const warnings: string[] = [];

    const safe = async <T>(
      fn: () => Promise<T>,
      name: string,
      fallback: T,
    ): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        warnings.push(`${name}: ${(e as Error).message}`);
        return fallback;
      }
    };

    const plQbo: Record<string, string | undefined> = {
      accounting_method: p.accountingMethod,
      ...(p.customerId && { customer: p.customerId }),
      ...(p.summarizeColumnBy && { summarize_column_by: p.summarizeColumnBy }),
    };
    const vendorQbo: Record<string, string | undefined> = {
      accounting_method: p.accountingMethod,
      ...(p.vendorId && { vendor: p.vendorId }),
    };
    const apQbo: Record<string, string | undefined> = p.vendorId
      ? { vendor: p.vendorId }
      : {};

    const [
      profitAndLoss,
      profitAndLossDetail,
      vendorExpenses,
      agedPayables,
      vendorBalanceDetail,
    ] = await Promise.all([
      safe(
        () => this.fetchAndParseReport(rid, 'ProfitAndLoss', p, plQbo, true),
        'ProfitAndLoss',
        this.emptyParsedReport('ProfitAndLoss', p),
      ),
      safe(
        () =>
          this.fetchAndParseReport(rid, 'ProfitAndLossDetail', p, plQbo, true),
        'ProfitAndLossDetail',
        this.emptyParsedReport('ProfitAndLossDetail', p),
      ),
      safe(
        () =>
          this.fetchAndParseReport(rid, 'VendorExpenses', p, vendorQbo, true),
        'VendorExpenses',
        this.emptyParsedReport('VendorExpenses', p),
      ),
      safe(
        () => this.fetchAndParseReport(rid, 'AgedPayables', p, apQbo, false),
        'AgedPayables',
        this.emptyParsedReport('AgedPayables', p),
      ),
      safe(
        () =>
          this.fetchAndParseReport(
            rid,
            'VendorBalanceDetail',
            p,
            vendorQbo,
            true,
          ),
        'VendorBalanceDetail',
        this.emptyParsedReport('VendorBalanceDetail', p),
      ),
    ]);

    return {
      customerId: p.customerId,
      profitAndLoss,
      profitAndLossDetail,
      vendorExpenses,
      agedPayables,
      vendorBalanceDetail,
      warnings,
      coverage: this.buildCoverage(p),
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 5 private helpers
  // ---------------------------------------------------------------------------

  /**
   * Core fetcher for QBO financial reports.
   * When supportsDateRange is true, the date range is split into 6-month
   * chunks and results are combined into a single ParsedReport.
   * When false (point-in-time reports like AgedPayables), the endDate is
   * passed as report_date and no splitting is performed.
   */
  private async fetchAndParseReport(
    rid: string,
    qboReportName: string,
    params: ReportParams,
    qboParams: Record<string, string | number | undefined>,
    supportsDateRange: boolean,
  ): Promise<ParsedReport> {
    const coverage = this.buildCoverage(params);
    const include = params.includeRaw === true;
    const cleaned = this.cleanQboParams(qboParams);

    if (!supportsDateRange) {
      const raw = await this.apiService.report(rid, qboReportName, {
        report_date: params.endDate,
        ...cleaned,
      });
      const rows = parseQboReportRows(qboReportName, raw);
      return {
        reportName: qboReportName,
        rows,
        summary: buildReportSummary(rows),
        coverage,
        ...(include ? { raw } : {}),
      };
    }

    const allRows: ReportRow[] = [];
    const rawChunks: unknown[] = [];

    for (const chunk of coverage.dateChunks) {
      const raw = await this.apiService.report(rid, qboReportName, {
        start_date: chunk.start,
        end_date: chunk.end,
        ...cleaned,
      });
      allRows.push(...parseQboReportRows(qboReportName, raw));
      if (include) rawChunks.push(raw);
    }

    return {
      reportName: qboReportName,
      rows: allRows,
      summary: buildReportSummary(allRows),
      coverage,
      ...(include
        ? { raw: rawChunks.length === 1 ? rawChunks[0] : rawChunks }
        : {}),
    };
  }

  private cleanQboParams(
    params: Record<string, string | number | undefined>,
  ): Record<string, string | number> {
    return Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    ) as Record<string, string | number>;
  }

  private buildCoverage(params: ReportParams): ReportCoverage {
    return {
      start: params.startDate,
      end: params.endDate,
      dateChunks: splitDateRange(params.startDate, params.endDate),
    };
  }

  private emptyParsedReport(
    reportName: string,
    params: ReportParams,
  ): ParsedReport {
    return {
      reportName,
      rows: [],
      summary: {},
      coverage: this.buildCoverage(params),
    };
  }
}
