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

export interface QboCustomer {
  Id: string;
  DisplayName: string;
  [key: string]: unknown;
}

export interface QboInvoice {
  Id: string;
  TotalAmt: number;
  Balance: number;
  TxnDate?: string;
  DueDate?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string } | string;
  [key: string]: unknown;
}

export interface QboEstimate {
  Id: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string } | string;
  [key: string]: unknown;
}

export interface QboCustomerResponse {
  QueryResponse?: { Customer?: QboCustomer[] };
}

export interface QboInvoiceResponse {
  QueryResponse?: { Invoice?: QboInvoice[] };
}

export interface QboEstimateResponse {
  QueryResponse?: { Estimate?: QboEstimate[] };
}

export interface QboPaymentResponse {
  QueryResponse?: { Payment?: Record<string, unknown>[] };
}

export interface JobIndex {
  byId: Record<string, QboCustomer>;
  projectNumberById: Record<string, string | null>;
}
