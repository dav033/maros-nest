import { CompanyType } from '../../../../common/enums/company-type.enum';
import { ProjectReportBundle } from '../reports/quickbooks-reports.service';
import {
  QboAiWarning,
  QboDirection,
  QboNormalizedLine,
  QboNormalizedTransaction,
  QboRef,
} from '../core/quickbooks-normalizer.service';
import {
  QboVendorCrmMapEntry,
  QboVendorMatchMethod,
  QboVendorMatchStatus,
} from '../vendor/quickbooks-vendor-matching.service';
import {
  QboNormalizedAttachment,
} from '../attachments/quickbooks-attachments.service';

export type QboCostEntityType =
  | 'Purchase'
  | 'Bill'
  | 'BillPayment'
  | 'VendorCredit'
  | 'PurchaseOrder'
  | 'JournalEntry';

export type QboJobCostClassification =
  | 'cash_out_paid'
  | 'open_ap'
  | 'commitment'
  | 'credit'
  | 'adjustment';

export interface QboJobCostingParams {
  realmId?: string;
  projectNumber?: string;
  qboCustomerId?: string;
  vendorId?: string;
  vendorName?: string;
  startDate?: string;
  endDate?: string;
  includeAttachments?: boolean;
  includeReports?: boolean;
  includeAttachmentDownloadUrls?: boolean;
  includeRaw?: boolean;
  accountingMethod?: 'Cash' | 'Accrual';
}

export interface QboResolvedProjectRef {
  found: boolean;
  projectNumber?: string;
  qboCustomerId?: string;
  displayName?: string;
  refs: QboRef[];
  raw?: Record<string, unknown>;
}

export interface QboJobCostAllocationDetail {
  linkedTxnId?: string;
  linkedTxnType?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  basisAmount: number;
  projectBasisAmount: number;
  allocatedAmount: number;
  allocationRatio: number;
  allocationMethod: string;
  category?: QboRef;
}

export interface QboJobCostTransaction {
  source: 'quickbooks';
  classification: QboJobCostClassification;
  direction: QboDirection;
  entityType: string;
  entityId: string;
  docNumber: string;
  txnDate: string;
  dueDate?: string;
  vendor?: QboRef;
  customer?: QboRef;
  projectRefs: QboRef[];
  lineItems: QboNormalizedLine[];
  linkedTxn: Array<{ txnId: string; txnType: string }>;
  account?: QboRef;
  category?: QboRef;
  memo: string;
  description: string;
  billableStatus?: string;
  status?: string;
  totalAmount: number;
  openBalance?: number;
  allocatedAmount: number;
  allocationRatio: number;
  allocationMethod: string;
  allocationDetails: QboJobCostAllocationDetail[];
  attachments: QboNormalizedAttachment[];
  warnings: QboAiWarning[];
  rawRef?: QboRef;
  raw?: Record<string, unknown>;
}

export interface QboJobCostSummary {
  cashOutPaid: number;
  openAp: number;
  committedPo: number;
  vendorCredits: number;
  adjustedCosts: number;
  totalJobCost: number;
}

export interface QboJobCostBreakdown {
  id?: string;
  name: string;
  crmCompanyId?: number;
  crmCompanyName?: string;
  crmType?: CompanyType;
  matchConfidence?: number;
  matchMethod?: QboVendorMatchMethod;
  matchStatus?: QboVendorMatchStatus;
  cashOutPaid: number;
  openAp: number;
  committedPo: number;
  vendorCredits: number;
  adjustedCosts: number;
  totalJobCost: number;
  transactionCount: number;
}

export interface QboJobCostCoverage {
  entitiesQueried: QboCostEntityType[];
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  paginationComplete: boolean;
  attachmentCoverage: {
    requested: boolean;
    entitiesChecked: number;
    attachmentsFound: number;
    fallbackUsed: boolean;
  };
}

export interface QboProjectCashOutResult {
  project: QboResolvedProjectRef;
  summary: QboJobCostSummary;
  transactions: QboJobCostTransaction[];
  vendorBreakdown: QboJobCostBreakdown[];
  categoryBreakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
  coverage: QboJobCostCoverage;
}

export interface QboProjectVendorTransactionsResult {
  project: QboResolvedProjectRef;
  transactions: QboJobCostTransaction[];
  vendorBreakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
  coverage: QboJobCostCoverage;
}

export interface QboProjectApStatusResult {
  project: QboResolvedProjectRef;
  summary: Pick<QboJobCostSummary, 'openAp' | 'vendorCredits'>;
  openBills: QboJobCostTransaction[];
  billPayments: QboJobCostTransaction[];
  vendorCredits: QboJobCostTransaction[];
  vendorBreakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
  coverage: QboJobCostCoverage;
}

export interface QboProjectJobCostSummaryResult {
  project: QboFullProjectRef;
  summary: QboFullProjectSummary;
  cashIn: QboProjectCashIn;
  cashOut: QboProjectCashOut;
  vendorBreakdown: QboJobCostBreakdown[];
  categoryBreakdown: QboJobCostBreakdown[];
  attachments: QboProjectAttachmentSummary;
  reports: QboProjectFinancialReports;
  warnings: QboAiWarning[];
  coverage: QboFullProjectCoverage;
}

export interface QboFullProjectRef {
  projectNumber: string;
  qboCustomerId: string;
  customerName: string;
  foundInQuickBooks: boolean;
  crmProjectId: number | null;
  crmLeadId: number | null;
}

export interface QboFullProjectSummary {
  estimateAmount: number;
  contractValue: number;
  invoicedAmount: number;
  customerPaymentsReceived: number;
  customerOutstandingBalance: number;
  cashOutPaid: number;
  openBills: number;
  committedPurchaseOrders: number;
  vendorCredits: number;
  adjustedCosts: number;
  totalJobCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  cashPositionVsCosts: number;
}

export interface QboProjectCashIn {
  estimates: QboNormalizedTransaction[];
  invoices: QboNormalizedTransaction[];
  payments: QboNormalizedTransaction[];
}

export interface QboProjectCashOut {
  paid: QboJobCostTransaction[];
  openAp: QboJobCostTransaction[];
  credits: QboJobCostTransaction[];
  commitments: QboJobCostTransaction[];
  adjustments: QboJobCostTransaction[];
}

export interface QboMissingAttachmentTransaction {
  entityType: string;
  entityId: string;
  docNumber: string;
  txnDate: string;
  totalAmount: number;
  vendor?: QboRef;
  customer?: QboRef;
}

export interface QboProjectAttachmentSummary {
  total: number;
  byEntityType: Record<string, number>;
  missingAttachmentTransactions: QboMissingAttachmentTransaction[];
}

export interface QboProjectFinancialReports {
  profitAndLoss: ProjectReportBundle['profitAndLoss'] | null;
  profitAndLossDetail: ProjectReportBundle['profitAndLossDetail'] | null;
  vendorExpenses: ProjectReportBundle['vendorExpenses'] | null;
  agedPayables: ProjectReportBundle['agedPayables'] | null;
  generalLedgerDetail: ProjectReportBundle['generalLedgerDetail'] | null;
}

export interface QboFullProjectCoverage {
  realmId: string;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  entitiesQueried: string[];
  paginationComplete: boolean;
  reportChunks: Array<{ start: string; end: string }>;
  generatedAt: string;
}

export interface QboVendorTransactionsResult {
  vendorFilter: {
    vendorId?: string;
    vendorName?: string;
  };
  project?: QboResolvedProjectRef;
  summary: QboJobCostSummary;
  transactions: QboJobCostTransaction[];
  categoryBreakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
  coverage: QboJobCostCoverage;
}

export interface QboCustomerRecord {
  Id?: unknown;
  DisplayName?: unknown;
  FullyQualifiedName?: unknown;
  Job?: unknown;
  ParentRef?: unknown;
  [key: string]: unknown;
}

export interface RawCostBundle {
  purchases: Record<string, unknown>[];
  bills: Record<string, unknown>[];
  billPayments: Record<string, unknown>[];
  vendorCredits: Record<string, unknown>[];
  purchaseOrders: Record<string, unknown>[];
  journalEntries: Record<string, unknown>[];
}

export interface ProjectAllocation {
  amount: number;
  basisAmount: number;
  ratio: number;
  method: string;
  details: QboJobCostAllocationDetail[];
}

export interface TransactionDescriptor {
  entityType: QboCostEntityType;
  raw: Record<string, unknown>;
  normalized: QboNormalizedTransaction;
  classification: QboJobCostClassification;
  allocatedAmount: number;
  allocationRatio: number;
  allocationMethod: string;
  allocationDetails: QboJobCostAllocationDetail[];
}

export interface InternalJobCostResult {
  project?: QboResolvedProjectRef;
  summary: QboJobCostSummary;
  transactions: QboJobCostTransaction[];
  vendorBreakdown: QboJobCostBreakdown[];
  categoryBreakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
  coverage: QboJobCostCoverage;
}

export interface AttachmentFetchResult {
  byDescriptor: Map<string, QboNormalizedAttachment[]>;
  warningsByDescriptor: Map<string, QboAiWarning[]>;
  warnings: QboAiWarning[];
  entitiesChecked: number;
  attachmentsFound: number;
  fallbackUsed: boolean;
}

export const COST_ENTITIES: QboCostEntityType[] = [
  'Purchase',
  'Bill',
  'BillPayment',
  'VendorCredit',
  'PurchaseOrder',
  'JournalEntry',
];

export type VendorBreakdownResult = {
  breakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
};

export type CashInEntityName = 'Estimate' | 'Invoice' | 'Payment';

export type QboVendorCrmEntry = QboVendorCrmMapEntry;

