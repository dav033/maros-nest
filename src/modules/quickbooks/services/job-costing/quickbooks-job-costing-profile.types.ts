import {
  QboAiWarning,
  QboNormalizedTransaction,
} from '../core/quickbooks-normalizer.service';
import {
  InternalJobCostResult,
  QboJobCostBreakdown,
  QboJobCostingParams,
  QboJobCostTransaction,
  QboProjectAttachmentSummary,
  QboProjectCashIn,
  QboProjectFinancialReports,
  QboResolvedProjectRef,
} from './quickbooks-job-costing.types';

export interface ProjectCashInFetchResult {
  cashIn: QboProjectCashIn;
  warnings: QboAiWarning[];
  entitiesQueried: string[];
}

export interface ProjectAttachmentSummaryResult {
  attachments: QboProjectAttachmentSummary;
  warnings: QboAiWarning[];
  entitiesQueried: string[];
}

export interface ProjectReportsFetchResult {
  reports: QboProjectFinancialReports;
  warnings: QboAiWarning[];
  reportChunks: Array<{ start: string; end: string }>;
  entitiesQueried: string[];
}

export interface FullProjectWarningsInput {
  hasDateFilter: boolean;
  allTransactions: Array<QboNormalizedTransaction | QboJobCostTransaction>;
  cashOutTransactions: QboJobCostTransaction[];
  vendorBreakdown: QboJobCostBreakdown[];
  attachmentSummary: QboProjectAttachmentSummary;
  reportChunks: Array<{ start: string; end: string }>;
  reportWarningsPresent: boolean;
}

export interface QuickbooksJobCostingProfileContext {
  asRecord(value: unknown): Record<string, unknown>;
  buildWhereOptions(...parts: Array<string | undefined>): { where?: string };
  projectCustomerId(project: QboResolvedProjectRef): string;
  transactionMatchesProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef,
  ): boolean;
  entityKey(entityType: string, entityId: string): string;
  money(value: number): number;
  isAcceptedEstimate(txn: QboNormalizedTransaction): boolean;
  hasLineWithoutProjectRef(
    txn: QboNormalizedTransaction | QboJobCostTransaction,
  ): boolean;
  isProportionalBillPaymentAllocation(txn: QboJobCostTransaction): boolean;
  uniqueStrings(values: string[]): string[];
  trim(value: unknown): string;
}

export interface BuildProjectJobCostSummaryInput {
  realmId: string;
  project: QboResolvedProjectRef;
  params: QboJobCostingParams;
  jobCost: InternalJobCostResult;
  context: QuickbooksJobCostingProfileContext;
}

export interface EmptyFullProjectResultInput {
  realmId: string;
  project: QboResolvedProjectRef;
  params: QboJobCostingParams;
  warnings: QboAiWarning[];
  context: QuickbooksJobCostingProfileContext;
}

