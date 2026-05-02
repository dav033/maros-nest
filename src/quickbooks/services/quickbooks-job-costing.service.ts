import { Injectable } from '@nestjs/common';
import { CompanyType } from '../../common/enums/company-type.enum';
import { QuickbooksApiService } from './quickbooks-api.service';
import { QuickbooksFinancialsService } from './quickbooks-financials.service';
import {
  ProjectReportBundle,
  QuickbooksReportsService,
} from './quickbooks-reports.service';
import {
  QboAttachmentEntityRef,
  QboNormalizedAttachment,
  QuickbooksAttachmentsService,
} from './quickbooks-attachments.service';
import {
  QboAiWarning,
  QboDirection,
  QboNormalizedLine,
  QboNormalizedTransaction,
  QboRef,
  QuickbooksNormalizerService,
} from './quickbooks-normalizer.service';
import {
  QboVendorCrmMapEntry,
  QboVendorMatchMethod,
  QboVendorMatchStatus,
  QuickbooksVendorMatchingService,
} from './quickbooks-vendor-matching.service';

type QboCostEntityType =
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

interface QboCustomerRecord {
  Id?: unknown;
  DisplayName?: unknown;
  FullyQualifiedName?: unknown;
  Job?: unknown;
  ParentRef?: unknown;
  [key: string]: unknown;
}

interface RawCostBundle {
  purchases: Record<string, unknown>[];
  bills: Record<string, unknown>[];
  billPayments: Record<string, unknown>[];
  vendorCredits: Record<string, unknown>[];
  purchaseOrders: Record<string, unknown>[];
  journalEntries: Record<string, unknown>[];
}

interface ProjectAllocation {
  amount: number;
  basisAmount: number;
  ratio: number;
  method: string;
  details: QboJobCostAllocationDetail[];
}

interface TransactionDescriptor {
  entityType: QboCostEntityType;
  raw: Record<string, unknown>;
  normalized: QboNormalizedTransaction;
  classification: QboJobCostClassification;
  allocatedAmount: number;
  allocationRatio: number;
  allocationMethod: string;
  allocationDetails: QboJobCostAllocationDetail[];
}

interface InternalJobCostResult {
  project?: QboResolvedProjectRef;
  summary: QboJobCostSummary;
  transactions: QboJobCostTransaction[];
  vendorBreakdown: QboJobCostBreakdown[];
  categoryBreakdown: QboJobCostBreakdown[];
  warnings: QboAiWarning[];
  coverage: QboJobCostCoverage;
}

interface AttachmentFetchResult {
  byDescriptor: Map<string, QboNormalizedAttachment[]>;
  warningsByDescriptor: Map<string, QboAiWarning[]>;
  warnings: QboAiWarning[];
  entitiesChecked: number;
  attachmentsFound: number;
  fallbackUsed: boolean;
}

const COST_ENTITIES: QboCostEntityType[] = [
  'Purchase',
  'Bill',
  'BillPayment',
  'VendorCredit',
  'PurchaseOrder',
  'JournalEntry',
];

@Injectable()
export class QuickbooksJobCostingService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly financials: QuickbooksFinancialsService,
    private readonly attachmentsService: QuickbooksAttachmentsService,
    private readonly vendorMatching: QuickbooksVendorMatchingService,
    private readonly reports: QuickbooksReportsService,
  ) {}

  async getProjectCashOut(
    params: QboJobCostingParams,
  ): Promise<QboProjectCashOutResult> {
    const project = await this.findProjectRefs(params);
    if (!this.hasProjectIdentity(project)) {
      const warnings = [
        this.normalizer.warning(
          'PROJECT_NOT_RESOLVED',
          'Provide projectNumber or qboCustomerId to calculate project cash out.',
        ),
      ];
      return this.emptyProjectResult(project, params, warnings);
    }

    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: true,
    });

    return {
      project,
      summary: result.summary,
      transactions: result.transactions,
      vendorBreakdown: result.vendorBreakdown,
      categoryBreakdown: result.categoryBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async getProjectVendorTransactions(
    params: QboJobCostingParams,
  ): Promise<QboProjectVendorTransactionsResult> {
    const project = await this.findProjectRefs(params);
    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: true,
    });

    return {
      project,
      transactions: result.transactions.filter((txn) => txn.vendor),
      vendorBreakdown: result.vendorBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async getProjectApStatus(
    params: QboJobCostingParams,
  ): Promise<QboProjectApStatusResult> {
    const project = await this.findProjectRefs(params);
    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: true,
    });

    return {
      project,
      summary: {
        openAp: result.summary.openAp,
        vendorCredits: result.summary.vendorCredits,
      },
      openBills: result.transactions.filter(
        (txn) => txn.classification === 'open_ap',
      ),
      billPayments: result.transactions.filter(
        (txn) =>
          txn.classification === 'cash_out_paid' &&
          txn.entityType === 'BillPayment',
      ),
      vendorCredits: result.transactions.filter(
        (txn) => txn.classification === 'credit',
      ),
      vendorBreakdown: result.vendorBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async getProjectJobCostSummary(
    params: QboJobCostingParams,
  ): Promise<QboProjectJobCostSummaryResult> {
    const realmId = await this.resolveRealmId(params.realmId);
    const normalizedParams: QboJobCostingParams = { ...params, realmId };
    const project = await this.findProjectRefs(normalizedParams);
    if (!this.hasProjectIdentity(project)) {
      return this.emptyFullProjectResult(realmId, project, normalizedParams, [
        this.normalizer.warning(
          'PROJECT_NOT_RESOLVED',
          'Provide projectNumber or qboCustomerId to build the project financial profile.',
        ),
      ]);
    }
    const result = await this.collectJobCost(normalizedParams, {
      project,
      requireProjectMatch: true,
    });
    const cashInResult = await this.fetchProjectCashIn(
      realmId,
      project,
      normalizedParams,
    );
    const reportResult = await this.fetchProjectReports(
      realmId,
      project,
      normalizedParams,
    );
    const attachmentResult = await this.buildProjectAttachmentSummary(
      realmId,
      project,
      normalizedParams,
      cashInResult.cashIn,
      result.transactions,
    );
    const cashOut = this.groupCashOut(result.transactions);
    const summary = this.buildFullProjectSummary(
      cashInResult.cashIn,
      result.summary,
    );
    const profileWarnings = this.buildFullProjectWarnings(
      normalizedParams,
      cashInResult.cashIn,
      result.transactions,
      result.vendorBreakdown,
      attachmentResult.attachments,
      reportResult.reportChunks,
      reportResult.warnings.length > 0,
    );

    return {
      project: this.toFullProjectRef(project, normalizedParams),
      summary,
      cashIn: cashInResult.cashIn,
      cashOut,
      vendorBreakdown: result.vendorBreakdown,
      categoryBreakdown: result.categoryBreakdown,
      attachments: attachmentResult.attachments,
      reports: reportResult.reports,
      coverage: {
        realmId,
        dateRange: {
          startDate: normalizedParams.startDate ?? null,
          endDate: normalizedParams.endDate ?? null,
        },
        entitiesQueried: this.uniqueStrings([
          ...result.coverage.entitiesQueried,
          ...cashInResult.entitiesQueried,
          ...attachmentResult.entitiesQueried,
          ...reportResult.entitiesQueried,
        ]),
        paginationComplete: result.coverage.paginationComplete,
        reportChunks: reportResult.reportChunks,
        generatedAt: new Date().toISOString(),
      },
      warnings: this.normalizer.dedupeWarnings([
        ...result.warnings,
        ...cashInResult.warnings,
        ...attachmentResult.warnings,
        ...reportResult.warnings,
        ...profileWarnings,
      ]),
    };
  }

  private async fetchProjectCashIn(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
  ): Promise<{
    cashIn: QboProjectCashIn;
    warnings: QboAiWarning[];
    entitiesQueried: string[];
  }> {
    const warnings: QboAiWarning[] = [];
    const customerId = this.projectCustomerId(project);
    const dateWhere = this.apiService.buildDateWhereClause(params).where;
    const customerWhere = customerId
      ? `CustomerRef = '${this.apiService.escapeQboString(customerId)}'`
      : undefined;
    const customerScopedOptions = this.buildWhereOptions(
      customerWhere,
      dateWhere,
    );
    const paymentOptions = this.buildWhereOptions(dateWhere);

    const [estimateRows, invoiceRows, paymentRows] = await Promise.all([
      this.queryCashInEntity(
        realmId,
        'Estimate',
        customerScopedOptions,
        warnings,
      ),
      this.queryCashInEntity(
        realmId,
        'Invoice',
        customerScopedOptions,
        warnings,
      ),
      this.queryCashInEntity(realmId, 'Payment', paymentOptions, warnings),
    ]);

    const estimates = estimateRows
      .map((row) => this.normalizer.normalizeEstimate(row))
      .filter((txn) => this.cashInBelongsToProject(txn, project, customerId));
    const invoices = invoiceRows
      .map((row) => this.normalizer.normalizeInvoice(row))
      .filter((txn) => this.cashInBelongsToProject(txn, project, customerId));
    const projectInvoiceIds = new Set(
      invoices.map((invoice) => invoice.entityId).filter(Boolean),
    );
    const payments = paymentRows
      .map((row) => this.normalizer.normalizePayment(row))
      .filter((txn) =>
        this.paymentBelongsToProject(
          txn,
          project,
          customerId,
          projectInvoiceIds,
        ),
      );

    return {
      cashIn: { estimates, invoices, payments },
      warnings: this.normalizer.dedupeWarnings([
        ...warnings,
        ...estimates.flatMap((txn) => txn.warnings),
        ...invoices.flatMap((txn) => txn.warnings),
        ...payments.flatMap((txn) => txn.warnings),
      ]),
      entitiesQueried: ['Estimate', 'Invoice', 'Payment'],
    };
  }

  private async queryCashInEntity(
    realmId: string,
    entityName: 'Estimate' | 'Invoice' | 'Payment',
    options: { where?: string },
    warnings: QboAiWarning[],
  ): Promise<Record<string, unknown>[]> {
    try {
      const rows = await this.apiService.queryAll(realmId, entityName, options);
      return rows.map((row) => this.asRecord(row));
    } catch {
      warnings.push(
        this.normalizer.warning(
          'cash_in_query_limited',
          `QuickBooks ${entityName} data could not be included in the project profile.`,
        ),
      );
      return [];
    }
  }

  private cashInBelongsToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef,
    customerId?: string,
  ): boolean {
    if (customerId && txn.customer?.value === customerId) return true;
    return this.transactionMatchesProject(txn, project);
  }

  private paymentBelongsToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef,
    customerId: string | undefined,
    projectInvoiceIds: Set<string>,
  ): boolean {
    if (
      txn.linkedTxn.some(
        (linked) =>
          linked.txnType === 'Invoice' && projectInvoiceIds.has(linked.txnId),
      )
    ) {
      return true;
    }
    return this.cashInBelongsToProject(txn, project, customerId);
  }

  private async buildProjectAttachmentSummary(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    cashIn: QboProjectCashIn,
    cashOutTransactions: QboJobCostTransaction[],
  ): Promise<{
    attachments: QboProjectAttachmentSummary;
    warnings: QboAiWarning[];
    entitiesQueried: string[];
  }> {
    const transactions = [
      ...cashIn.estimates,
      ...cashIn.invoices,
      ...cashIn.payments,
      ...cashOutTransactions,
    ];

    if (params.includeAttachments === false) {
      return {
        attachments: {
          total: 0,
          byEntityType: {},
          missingAttachmentTransactions: [],
        },
        warnings: [],
        entitiesQueried: [],
      };
    }

    try {
      const projectAttachments =
        await this.attachmentsService.getProjectAttachments({
          realmId,
          projectNumber: project.projectNumber,
          qboCustomerId: this.projectCustomerId(project),
          startDate: params.startDate,
          endDate: params.endDate,
          includeTempDownloadUrl: false,
        });

      return {
        attachments: this.summarizeProjectAttachments(
          transactions,
          projectAttachments.attachments,
          projectAttachments.byEntity,
        ),
        warnings: projectAttachments.warnings,
        entitiesQueried: ['Attachable'],
      };
    } catch {
      const attachments = this.summarizeProjectAttachments(
        transactions,
        [],
        [],
      );
      return {
        attachments,
        warnings: [
          this.normalizer.warning(
            'project_attachment_lookup_limited',
            'QuickBooks attachments could not be fully checked for this project profile.',
          ),
        ],
        entitiesQueried: ['Attachable'],
      };
    }
  }

  private summarizeProjectAttachments(
    transactions: Array<QboNormalizedTransaction | QboJobCostTransaction>,
    attachments: QboNormalizedAttachment[],
    byEntity: Array<{
      entityRef: QboAttachmentEntityRef;
      attachments: QboNormalizedAttachment[];
    }>,
  ): QboProjectAttachmentSummary {
    const byEntityType: Record<string, number> = {};
    const attachmentKeys = new Set<string>();

    for (const attachment of attachments) {
      const type = attachment.linkedEntityType || 'Unknown';
      byEntityType[type] = (byEntityType[type] ?? 0) + 1;
      if (attachment.linkedEntityType && attachment.linkedEntityId) {
        attachmentKeys.add(
          this.entityKey(
            attachment.linkedEntityType,
            attachment.linkedEntityId,
          ),
        );
      }
    }

    for (const entity of byEntity) {
      if (entity.attachments.length > 0) {
        attachmentKeys.add(
          this.entityKey(
            entity.entityRef.entityType,
            entity.entityRef.entityId,
          ),
        );
      }
    }

    const missingAttachmentTransactions = transactions
      .filter((txn) => txn.entityId)
      .filter((txn) => {
        if (txn.attachments.length > 0) return false;
        return !attachmentKeys.has(
          this.entityKey(txn.entityType, txn.entityId),
        );
      })
      .map((txn) => this.missingAttachmentTransaction(txn));

    return {
      total: attachments.length,
      byEntityType,
      missingAttachmentTransactions: this.uniqueMissingAttachmentTransactions(
        missingAttachmentTransactions,
      ),
    };
  }

  private missingAttachmentTransaction(
    txn: QboNormalizedTransaction | QboJobCostTransaction,
  ): QboMissingAttachmentTransaction {
    const missing: QboMissingAttachmentTransaction = {
      entityType: txn.entityType,
      entityId: txn.entityId,
      docNumber: txn.docNumber,
      txnDate: txn.txnDate,
      totalAmount:
        'allocatedAmount' in txn ? txn.allocatedAmount : txn.totalAmount,
    };
    if (txn.vendor) missing.vendor = txn.vendor;
    if (txn.customer) missing.customer = txn.customer;
    return missing;
  }

  private uniqueMissingAttachmentTransactions(
    transactions: QboMissingAttachmentTransaction[],
  ): QboMissingAttachmentTransaction[] {
    const byKey = new Map<string, QboMissingAttachmentTransaction>();
    for (const txn of transactions) {
      byKey.set(this.entityKey(txn.entityType, txn.entityId), txn);
    }
    return [...byKey.values()].sort((a, b) =>
      `${a.txnDate}:${a.entityType}:${a.entityId}`.localeCompare(
        `${b.txnDate}:${b.entityType}:${b.entityId}`,
      ),
    );
  }

  private async fetchProjectReports(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
  ): Promise<{
    reports: QboProjectFinancialReports;
    warnings: QboAiWarning[];
    reportChunks: Array<{ start: string; end: string }>;
    entitiesQueried: string[];
  }> {
    const emptyReports = this.emptyProjectReports();
    if (params.includeReports === false) {
      return {
        reports: emptyReports,
        warnings: [],
        reportChunks: [],
        entitiesQueried: [],
      };
    }

    if (!params.startDate || !params.endDate) {
      return {
        reports: emptyReports,
        warnings: [
          this.normalizer.warning(
            'reports_limited_or_chunked',
            'Project reports need a startDate and endDate, so report data was not included.',
          ),
        ],
        reportChunks: [],
        entitiesQueried: [],
      };
    }

    try {
      const bundle = await this.reports.getProjectReportBundle({
        realmId,
        startDate: params.startDate,
        endDate: params.endDate,
        customerId: this.projectCustomerId(project),
        accountingMethod: params.accountingMethod,
        includeRaw: params.includeRaw,
      });
      const reportWarnings = bundle.warnings.map((message) =>
        this.normalizer.warning('reports_limited_or_chunked', message),
      );
      if (bundle.coverage.dateChunks.length > 1) {
        reportWarnings.push(
          this.normalizer.warning(
            'reports_limited_or_chunked',
            'QuickBooks reports were split into six-month windows and combined.',
          ),
        );
      }

      return {
        reports: {
          profitAndLoss: bundle.profitAndLoss,
          profitAndLossDetail: bundle.profitAndLossDetail,
          vendorExpenses: bundle.vendorExpenses,
          agedPayables: bundle.agedPayables,
          generalLedgerDetail: bundle.generalLedgerDetail ?? null,
        },
        warnings: reportWarnings,
        reportChunks: bundle.coverage.dateChunks,
        entitiesQueried: [
          'Report:ProfitAndLoss',
          'Report:ProfitAndLossDetail',
          'Report:VendorExpenses',
          'Report:AgedPayables',
        ],
      };
    } catch {
      return {
        reports: emptyReports,
        warnings: [
          this.normalizer.warning(
            'reports_limited_or_chunked',
            'QuickBooks reports could not be included in this project profile.',
          ),
        ],
        reportChunks: [],
        entitiesQueried: [
          'Report:ProfitAndLoss',
          'Report:ProfitAndLossDetail',
          'Report:VendorExpenses',
          'Report:AgedPayables',
        ],
      };
    }
  }

  private buildFullProjectSummary(
    cashIn: QboProjectCashIn,
    costs: QboJobCostSummary,
  ): QboFullProjectSummary {
    const estimateAmount = this.money(
      cashIn.estimates.reduce((sum, txn) => sum + txn.totalAmount, 0),
    );
    const acceptedEstimateAmount = this.money(
      cashIn.estimates
        .filter((txn) => this.isAcceptedEstimate(txn))
        .reduce((sum, txn) => sum + txn.totalAmount, 0),
    );
    const invoicedAmount = this.money(
      cashIn.invoices.reduce((sum, txn) => sum + txn.totalAmount, 0),
    );
    const customerPaymentsReceived = this.money(
      cashIn.payments.reduce((sum, txn) => sum + txn.totalAmount, 0),
    );
    const customerOutstandingBalance = this.money(
      cashIn.invoices.reduce((sum, txn) => sum + (txn.openBalance ?? 0), 0),
    );
    const contractValue =
      acceptedEstimateAmount > 0
        ? acceptedEstimateAmount
        : estimateAmount > 0
          ? estimateAmount
          : invoicedAmount;
    const cashOutPaid = this.money(costs.cashOutPaid);
    const openBills = this.money(costs.openAp);
    const committedPurchaseOrders = this.money(costs.committedPo);
    const vendorCredits = this.money(costs.vendorCredits);
    const adjustedCosts = this.money(costs.adjustedCosts);
    const totalJobCost = this.money(
      cashOutPaid + openBills + adjustedCosts - vendorCredits,
    );
    const grossProfit = this.money(invoicedAmount - totalJobCost);
    const grossMarginPercent =
      invoicedAmount === 0
        ? 0
        : this.money((grossProfit / invoicedAmount) * 100);

    return {
      estimateAmount,
      contractValue: this.money(contractValue),
      invoicedAmount,
      customerPaymentsReceived,
      customerOutstandingBalance,
      cashOutPaid,
      openBills,
      committedPurchaseOrders,
      vendorCredits,
      adjustedCosts,
      totalJobCost,
      grossProfit,
      grossMarginPercent,
      cashPositionVsCosts: this.money(customerPaymentsReceived - cashOutPaid),
    };
  }

  private groupCashOut(
    transactions: QboJobCostTransaction[],
  ): QboProjectCashOut {
    return {
      paid: transactions.filter(
        (txn) => txn.classification === 'cash_out_paid',
      ),
      openAp: transactions.filter((txn) => txn.classification === 'open_ap'),
      credits: transactions.filter((txn) => txn.classification === 'credit'),
      commitments: transactions.filter(
        (txn) => txn.classification === 'commitment',
      ),
      adjustments: transactions.filter(
        (txn) => txn.classification === 'adjustment',
      ),
    };
  }

  private buildFullProjectWarnings(
    params: QboJobCostingParams,
    cashIn: QboProjectCashIn,
    cashOutTransactions: QboJobCostTransaction[],
    vendorBreakdown: QboJobCostBreakdown[],
    attachmentSummary: QboProjectAttachmentSummary,
    reportChunks: Array<{ start: string; end: string }>,
    reportWarningsPresent: boolean,
  ): QboAiWarning[] {
    const warnings: QboAiWarning[] = [];
    const allTransactions = [
      ...cashIn.estimates,
      ...cashIn.invoices,
      ...cashIn.payments,
      ...cashOutTransactions,
    ];

    if (allTransactions.some((txn) => this.hasLineWithoutProjectRef(txn))) {
      warnings.push(
        this.normalizer.warning(
          'missing_project_ref_on_some_lines',
          'Some transactions include lines without a project reference, so those lines were not counted unless the transaction itself matched the project.',
        ),
      );
    }

    if (attachmentSummary.missingAttachmentTransactions.length > 0) {
      warnings.push(
        this.normalizer.warning(
          'transactions_without_attachments',
          'Some project transactions do not have QuickBooks attachment metadata.',
        ),
      );
    }

    if (
      cashOutTransactions.some((txn) =>
        this.isProportionalBillPaymentAllocation(txn),
      )
    ) {
      warnings.push(
        this.normalizer.warning(
          'bill_payments_allocated_proportionally',
          'Some bill payments were allocated proportionally because the payment covers bills or lines beyond this project.',
        ),
      );
    }

    if (reportWarningsPresent || reportChunks.length > 1) {
      warnings.push(
        this.normalizer.warning(
          'reports_limited_or_chunked',
          'Some project reports were limited or split into smaller date windows.',
        ),
      );
    }

    if (params.startDate || params.endDate) {
      warnings.push(
        this.normalizer.warning(
          'incomplete_due_to_date_filter',
          'This profile only includes transactions inside the requested date range.',
        ),
      );
    }

    if (
      vendorBreakdown.some(
        (bucket) =>
          bucket.name !== 'Uncategorized' &&
          !bucket.crmCompanyId &&
          !bucket.matchConfidence,
      )
    ) {
      warnings.push(
        this.normalizer.warning(
          'no_qbo_vendor_match_for_crm_subcontractor',
          'Some QuickBooks vendors in this project are not linked to a CRM supplier or subcontractor.',
        ),
      );
    }

    return warnings;
  }

  private toFullProjectRef(
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
  ): QboFullProjectRef {
    const qboCustomerId =
      this.projectCustomerId(project) || this.trim(params.qboCustomerId);
    const customerName =
      project.displayName ||
      project.refs.find((ref) => this.trim(ref.name))?.name ||
      '';

    return {
      projectNumber: project.projectNumber ?? this.trim(params.projectNumber),
      qboCustomerId,
      customerName,
      foundInQuickBooks: project.found === true && !!qboCustomerId,
      crmProjectId: null,
      crmLeadId: null,
    };
  }

  private emptyFullProjectResult(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    warnings: QboAiWarning[],
  ): QboProjectJobCostSummaryResult {
    return {
      project: this.toFullProjectRef(project, params),
      summary: this.buildFullProjectSummary(this.emptyProjectCashIn(), {
        cashOutPaid: 0,
        openAp: 0,
        committedPo: 0,
        vendorCredits: 0,
        adjustedCosts: 0,
        totalJobCost: 0,
      }),
      cashIn: this.emptyProjectCashIn(),
      cashOut: this.groupCashOut([]),
      vendorBreakdown: [],
      categoryBreakdown: [],
      attachments: {
        total: 0,
        byEntityType: {},
        missingAttachmentTransactions: [],
      },
      reports: this.emptyProjectReports(),
      warnings,
      coverage: {
        realmId,
        dateRange: {
          startDate: params.startDate ?? null,
          endDate: params.endDate ?? null,
        },
        entitiesQueried: [],
        paginationComplete: true,
        reportChunks: [],
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private emptyProjectCashIn(): QboProjectCashIn {
    return { estimates: [], invoices: [], payments: [] };
  }

  private emptyProjectReports(): QboProjectFinancialReports {
    return {
      profitAndLoss: null,
      profitAndLossDetail: null,
      vendorExpenses: null,
      agedPayables: null,
      generalLedgerDetail: null,
    };
  }

  async getVendorTransactions(
    params: QboJobCostingParams,
  ): Promise<QboVendorTransactionsResult> {
    const project =
      params.projectNumber || params.qboCustomerId
        ? await this.findProjectRefs(params)
        : undefined;
    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: !!project,
    });

    return {
      vendorFilter: {
        ...(params.vendorId && { vendorId: params.vendorId }),
        ...(params.vendorName && { vendorName: params.vendorName }),
      },
      ...(project && { project }),
      summary: result.summary,
      transactions: result.transactions,
      categoryBreakdown: result.categoryBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async findProjectRefs(
    params: Pick<
      QboJobCostingParams,
      'realmId' | 'projectNumber' | 'qboCustomerId'
    >,
  ): Promise<QboResolvedProjectRef> {
    const projectNumber = this.trim(params.projectNumber);
    const qboCustomerId = this.trim(params.qboCustomerId);

    if (!projectNumber && !qboCustomerId) {
      return { found: false, refs: [] };
    }

    const realmId = await this.resolveRealmId(params.realmId);

    if (qboCustomerId) {
      const raw = await this.fetchCustomerById(realmId, qboCustomerId);
      const displayName = this.stringValue(raw['DisplayName']);
      const ref: QboRef = {
        value: qboCustomerId,
        ...(displayName && { name: displayName }),
      };
      return {
        found: true,
        ...(projectNumber && { projectNumber }),
        qboCustomerId,
        ...(displayName && { displayName }),
        refs: [ref],
        ...(Object.keys(raw).length && { raw }),
      };
    }

    const customers = await this.findCustomersForProjectNumber(
      realmId,
      projectNumber,
    );
    const match = customers[0];

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
      raw: match,
    };
  }

  private async collectJobCost(
    params: QboJobCostingParams,
    options: {
      project?: QboResolvedProjectRef;
      requireProjectMatch: boolean;
    },
  ): Promise<InternalJobCostResult> {
    const realmId = await this.resolveRealmId(params.realmId);
    const includeAttachments = params.includeAttachments ?? true;
    const includeRaw = params.includeRaw ?? false;
    const warnings: QboAiWarning[] = [];
    const rawBundle = await this.fetchCostBundle(realmId, params);
    const billIndex = new Map<string, Record<string, unknown>>();

    for (const bill of rawBundle.bills) {
      const id = this.stringValue(bill['Id']);
      if (id) billIndex.set(id, bill);
    }

    await this.loadLinkedBillsForPayments(
      realmId,
      rawBundle.billPayments,
      billIndex,
      warnings,
    );

    const descriptors = this.buildTransactionDescriptors(
      rawBundle,
      billIndex,
      options.project,
      options.requireProjectMatch,
      params,
      warnings,
    );

    const attachmentResult = includeAttachments
      ? await this.fetchAttachmentsForDescriptors(
          realmId,
          descriptors,
          params.includeAttachmentDownloadUrls === true,
        )
      : {
          byDescriptor: new Map<string, QboNormalizedAttachment[]>(),
          warningsByDescriptor: new Map<string, QboAiWarning[]>(),
          warnings: [],
          entitiesChecked: 0,
          attachmentsFound: 0,
          fallbackUsed: false,
        };

    const transactions = descriptors.map((descriptor) =>
      this.toJobCostTransaction(
        descriptor,
        attachmentResult.byDescriptor.get(
          this.entityKey(descriptor.entityType, descriptor.normalized.entityId),
        ) ?? [],
        attachmentResult.warningsByDescriptor.get(
          this.entityKey(descriptor.entityType, descriptor.normalized.entityId),
        ) ?? [],
        includeRaw,
        includeAttachments,
      ),
    );

    const summary = this.summarize(transactions);
    const vendorBreakdown = await this.buildVendorBreakdown(
      realmId,
      transactions,
    );
    const resultWarnings = this.normalizer.dedupeWarnings([
      ...warnings,
      ...attachmentResult.warnings,
      ...vendorBreakdown.warnings,
      ...transactions.flatMap((txn) => txn.warnings),
    ]);

    return {
      project: options.project,
      summary,
      transactions,
      vendorBreakdown: vendorBreakdown.breakdown,
      categoryBreakdown: this.buildBreakdown(transactions, 'category'),
      warnings: resultWarnings,
      coverage: {
        entitiesQueried: COST_ENTITIES,
        dateRange: {
          startDate: params.startDate ?? null,
          endDate: params.endDate ?? null,
        },
        paginationComplete: true,
        attachmentCoverage: {
          requested: includeAttachments,
          entitiesChecked: attachmentResult.entitiesChecked,
          attachmentsFound: attachmentResult.attachmentsFound,
          fallbackUsed: attachmentResult.fallbackUsed,
        },
      },
    };
  }

  private buildTransactionDescriptors(
    rawBundle: RawCostBundle,
    billIndex: Map<string, Record<string, unknown>>,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    params: QboJobCostingParams,
    warnings: QboAiWarning[],
  ): TransactionDescriptor[] {
    const descriptors: TransactionDescriptor[] = [];

    for (const raw of rawBundle.purchases) {
      const normalized = this.normalizer.normalizePurchase(raw);
      if (!this.vendorMatches(normalized, params)) continue;
      const allocation = this.allocateTransactionToProject(
        normalized,
        project,
        requireProjectMatch,
      );
      if (!this.shouldIncludeAllocation(allocation, requireProjectMatch))
        continue;
      if (!this.isPaidPurchase(raw)) {
        warnings.push(
          this.normalizer.warning(
            'PURCHASE_PAYMENT_TYPE_NOT_INCLUDED',
            `Purchase ${normalized.entityId} has payment type '${this.stringValue(
              raw['PaymentType'],
            )}' and was not counted as paid cash out.`,
          ),
        );
        continue;
      }
      descriptors.push(
        this.descriptor(
          'Purchase',
          raw,
          normalized,
          'cash_out_paid',
          allocation,
        ),
      );
    }

    for (const raw of rawBundle.bills) {
      const normalized = this.normalizer.normalizeBill(raw);
      if (!this.vendorMatches(normalized, params)) continue;
      const allocation = this.allocateBillOpenAp(
        normalized,
        project,
        requireProjectMatch,
      );
      if (!this.shouldIncludeAllocation(allocation, requireProjectMatch))
        continue;
      if ((normalized.openBalance ?? 0) <= 0) continue;
      descriptors.push(
        this.descriptor('Bill', raw, normalized, 'open_ap', allocation),
      );
    }

    for (const raw of rawBundle.billPayments) {
      const normalized = this.normalizer.normalizeBillPayment(raw);
      if (!this.vendorMatches(normalized, params)) continue;
      const allocation = this.allocateBillPayment(
        raw,
        normalized,
        billIndex,
        project,
        requireProjectMatch,
        warnings,
      );
      if (!this.shouldIncludeAllocation(allocation, requireProjectMatch))
        continue;
      descriptors.push(
        this.descriptor(
          'BillPayment',
          raw,
          normalized,
          'cash_out_paid',
          allocation,
        ),
      );
    }

    for (const raw of rawBundle.vendorCredits) {
      const normalized = this.normalizer.normalizeVendorCredit(raw);
      if (!this.vendorMatches(normalized, params)) continue;
      const allocation = this.allocateTransactionToProject(
        normalized,
        project,
        requireProjectMatch,
      );
      if (!this.shouldIncludeAllocation(allocation, requireProjectMatch))
        continue;
      descriptors.push(
        this.descriptor('VendorCredit', raw, normalized, 'credit', allocation),
      );
    }

    for (const raw of rawBundle.purchaseOrders) {
      const normalized = this.normalizer.normalizePurchaseOrder(raw);
      if (!this.vendorMatches(normalized, params)) continue;
      if (this.isClosedPurchaseOrder(normalized)) continue;
      const allocation = this.allocateTransactionToProject(
        normalized,
        project,
        requireProjectMatch,
      );
      if (!this.shouldIncludeAllocation(allocation, requireProjectMatch))
        continue;
      descriptors.push(
        this.descriptor(
          'PurchaseOrder',
          raw,
          normalized,
          'commitment',
          allocation,
        ),
      );
    }

    for (const raw of rawBundle.journalEntries) {
      const normalized = this.normalizer.normalizeJournalEntry(raw);
      const allocation = this.allocateJournalEntry(
        raw,
        normalized,
        project,
        requireProjectMatch,
      );
      if (!this.shouldIncludeAllocation(allocation, requireProjectMatch)) {
        if (this.transactionMatchesProject(normalized, project)) {
          warnings.push(
            this.normalizer.warning(
              'JOURNAL_ENTRY_NOT_EXPLICIT_COST',
              `JournalEntry ${normalized.entityId} matched the project but did not explicitly affect an expense or COGS account.`,
            ),
          );
        }
        continue;
      }
      descriptors.push(
        this.descriptor(
          'JournalEntry',
          raw,
          normalized,
          'adjustment',
          allocation,
        ),
      );
    }

    return descriptors.sort((a, b) =>
      `${a.normalized.txnDate}:${a.normalized.entityType}:${a.normalized.entityId}`.localeCompare(
        `${b.normalized.txnDate}:${b.normalized.entityType}:${b.normalized.entityId}`,
      ),
    );
  }

  private descriptor(
    entityType: QboCostEntityType,
    raw: Record<string, unknown>,
    normalized: QboNormalizedTransaction,
    classification: QboJobCostClassification,
    allocation: ProjectAllocation,
  ): TransactionDescriptor {
    return {
      entityType,
      raw,
      normalized,
      classification,
      allocatedAmount: this.money(allocation.amount),
      allocationRatio: allocation.ratio,
      allocationMethod: allocation.method,
      allocationDetails: allocation.details,
    };
  }

  private toJobCostTransaction(
    descriptor: TransactionDescriptor,
    attachments: QboNormalizedAttachment[],
    attachmentWarnings: QboAiWarning[],
    includeRaw: boolean,
    attachmentsRequested: boolean,
  ): QboJobCostTransaction {
    const normalized = this.normalizeWithAttachments(
      descriptor.entityType,
      descriptor.raw,
      [],
    );
    const warnings = [...normalized.warnings, ...attachmentWarnings];
    if (attachmentsRequested && attachments.length === 0) {
      warnings.push(
        this.normalizer.warning(
          'transaction_without_attachment',
          `${normalized.entityType} ${normalized.entityId} has no QuickBooks attachment metadata.`,
        ),
      );
    }
    const transaction: QboJobCostTransaction = {
      source: 'quickbooks',
      classification: descriptor.classification,
      direction: normalized.direction,
      entityType: normalized.entityType,
      entityId: normalized.entityId,
      docNumber: normalized.docNumber,
      txnDate: normalized.txnDate,
      totalAmount: normalized.totalAmount,
      allocatedAmount: descriptor.allocatedAmount,
      allocationRatio: descriptor.allocationRatio,
      allocationMethod: descriptor.allocationMethod,
      allocationDetails: descriptor.allocationDetails,
      projectRefs: normalized.projectRefs,
      lineItems: normalized.lineItems,
      linkedTxn: normalized.linkedTxn,
      memo: normalized.memo,
      description: normalized.description,
      attachments,
      warnings: this.normalizer.dedupeWarnings(warnings),
    };

    if (normalized.dueDate) transaction.dueDate = normalized.dueDate;
    if (normalized.vendor) transaction.vendor = normalized.vendor;
    if (normalized.customer) transaction.customer = normalized.customer;
    if (normalized.account) transaction.account = normalized.account;
    if (normalized.category) transaction.category = normalized.category;
    if (normalized.billableStatus)
      transaction.billableStatus = normalized.billableStatus;
    if (normalized.status) transaction.status = normalized.status;
    if (normalized.openBalance !== undefined)
      transaction.openBalance = normalized.openBalance;
    if (normalized.rawRef) transaction.rawRef = normalized.rawRef;
    if (includeRaw) transaction.raw = descriptor.raw;

    return transaction;
  }

  private async fetchCostBundle(
    realmId: string,
    params: QboJobCostingParams,
  ): Promise<RawCostBundle> {
    const options = this.apiService.buildDateWhereClause(params);
    const [
      purchases,
      bills,
      billPayments,
      vendorCredits,
      purchaseOrders,
      journalEntries,
    ] = await Promise.all([
      this.apiService.queryAll(realmId, 'Purchase', options),
      this.apiService.queryAll(realmId, 'Bill', options),
      this.apiService.queryAll(realmId, 'BillPayment', options),
      this.apiService.queryAll(realmId, 'VendorCredit', options),
      this.apiService.queryAll(realmId, 'PurchaseOrder', options),
      this.apiService.queryAll(realmId, 'JournalEntry', options),
    ]);

    return {
      purchases: purchases.map((item) => this.asRecord(item)),
      bills: bills.map((item) => this.asRecord(item)),
      billPayments: billPayments.map((item) => this.asRecord(item)),
      vendorCredits: vendorCredits.map((item) => this.asRecord(item)),
      purchaseOrders: purchaseOrders.map((item) => this.asRecord(item)),
      journalEntries: journalEntries.map((item) => this.asRecord(item)),
    };
  }

  private async loadLinkedBillsForPayments(
    realmId: string,
    billPayments: Record<string, unknown>[],
    billIndex: Map<string, Record<string, unknown>>,
    warnings: QboAiWarning[],
  ): Promise<void> {
    const linkedBillIds = new Set<string>();
    for (const payment of billPayments) {
      for (const linked of this.extractLinkedTxnFromRaw(payment)) {
        if (linked.txnType === 'Bill' && linked.txnId) {
          linkedBillIds.add(linked.txnId);
        }
      }
    }

    await Promise.all(
      [...linkedBillIds]
        .filter((billId) => !billIndex.has(billId))
        .map(async (billId) => {
          try {
            const raw = await this.apiService.getById(realmId, 'bill', billId);
            const bill = this.apiService.unwrapQboEntity(raw, 'Bill');
            if (Object.keys(bill).length) billIndex.set(billId, bill);
          } catch {
            warnings.push(
              this.normalizer.warning(
                'LINKED_BILL_FETCH_FAILED',
                `Unable to fetch linked Bill ${billId} for BillPayment allocation.`,
              ),
            );
          }
        }),
    );
  }

  private allocateTransactionToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
  ): ProjectAllocation {
    if (!requireProjectMatch || !project) {
      return this.fullAllocation(txn.totalAmount, 'full_transaction');
    }

    const lineBasis = this.lineBasisAmount(txn.lineItems, txn.totalAmount);
    const matchingLines = txn.lineItems.filter((line) =>
      this.lineMatchesProject(line, project),
    );

    if (matchingLines.length) {
      const amount = matchingLines.reduce((sum, line) => sum + line.amount, 0);
      return {
        amount: this.money(amount),
        basisAmount: lineBasis,
        ratio: this.ratio(amount, lineBasis),
        method: 'project_line_amount',
        details: matchingLines.map((line) => ({
          basisAmount: lineBasis,
          projectBasisAmount: this.money(line.amount),
          allocatedAmount: this.money(line.amount),
          allocationRatio: this.ratio(line.amount, lineBasis),
          allocationMethod: 'project_line_amount',
          category: line.category ?? line.account,
        })),
      };
    }

    if (this.transactionMatchesProject(txn, project)) {
      return this.fullAllocation(txn.totalAmount, 'project_header_full');
    }

    return this.emptyAllocation('no_project_match');
  }

  private allocateBillOpenAp(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
  ): ProjectAllocation {
    if ((txn.openBalance ?? 0) <= 0) return this.emptyAllocation('bill_closed');
    const base = this.allocateTransactionToProject(
      txn,
      project,
      requireProjectMatch,
    );
    if (base.amount === 0 && requireProjectMatch) return base;
    const openAmount = this.money((txn.openBalance ?? 0) * base.ratio);
    return {
      amount: openAmount,
      basisAmount: txn.openBalance ?? 0,
      ratio: base.ratio,
      method:
        base.method === 'project_line_amount'
          ? 'open_ap_project_line_ratio'
          : 'open_ap_full',
      details: base.details.length
        ? base.details.map((detail) => ({
            ...detail,
            allocatedAmount: this.money(
              (txn.openBalance ?? 0) * detail.allocationRatio,
            ),
            allocationMethod: 'open_ap_project_line_ratio',
          }))
        : [
            {
              basisAmount: txn.openBalance ?? 0,
              projectBasisAmount: openAmount,
              allocatedAmount: openAmount,
              allocationRatio: base.ratio,
              allocationMethod: 'open_ap_full',
              category: txn.category ?? txn.account,
            },
          ],
    };
  }

  private allocateBillPayment(
    rawPayment: Record<string, unknown>,
    txn: QboNormalizedTransaction,
    billIndex: Map<string, Record<string, unknown>>,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    warnings: QboAiWarning[],
  ): ProjectAllocation {
    if (!requireProjectMatch || !project) {
      return this.fullAllocation(txn.totalAmount, 'linked_bill_full');
    }

    const details: QboJobCostAllocationDetail[] = [];
    const paymentLines = this.paymentAllocationLines(rawPayment, txn);

    for (const paymentLine of paymentLines) {
      const linkedBills = paymentLine.linkedTxn.filter(
        (linked) => linked.txnType === 'Bill' && linked.txnId,
      );
      if (!linkedBills.length) continue;

      const amountPerBill =
        linkedBills.length > 0
          ? paymentLine.amount / linkedBills.length
          : paymentLine.amount;

      for (const linked of linkedBills) {
        const billRaw = billIndex.get(linked.txnId);
        if (!billRaw) {
          warnings.push(
            this.normalizer.warning(
              'LINKED_BILL_NOT_AVAILABLE',
              `BillPayment ${txn.entityId} links to Bill ${linked.txnId}, but the bill was not available for allocation.`,
            ),
          );
          continue;
        }
        const bill = this.normalizer.normalizeBill(billRaw);
        const billAllocation = this.allocateTransactionToProject(
          bill,
          project,
          true,
        );
        if (billAllocation.amount === 0) continue;

        const allocatedAmount = this.money(
          amountPerBill * billAllocation.ratio,
        );
        details.push({
          linkedTxnId: linked.txnId,
          linkedTxnType: linked.txnType,
          sourceEntityType: 'Bill',
          sourceEntityId: bill.entityId,
          basisAmount: this.money(amountPerBill),
          projectBasisAmount: billAllocation.amount,
          allocatedAmount,
          allocationRatio: billAllocation.ratio,
          allocationMethod:
            billAllocation.ratio === 1
              ? 'linked_bill_full'
              : 'linked_bill_project_line_ratio',
          category: bill.category ?? bill.account,
        });
      }
    }

    if (!details.length) return this.emptyAllocation('no_linked_project_bill');

    const amount = this.money(
      details.reduce((sum, detail) => sum + detail.allocatedAmount, 0),
    );
    const basisAmount = this.money(
      details.reduce((sum, detail) => sum + detail.basisAmount, 0),
    );
    return {
      amount,
      basisAmount,
      ratio: this.ratio(amount, basisAmount),
      method: details.some(
        (detail) =>
          detail.allocationMethod === 'linked_bill_project_line_ratio',
      )
        ? 'linked_bill_project_line_ratio'
        : 'linked_bill_full',
      details,
    };
  }

  private allocateJournalEntry(
    raw: Record<string, unknown>,
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
  ): ProjectAllocation {
    const rawLines = this.asArray(raw['Line']);
    const details: QboJobCostAllocationDetail[] = [];
    let normalizedLineIndex = 0;

    for (const rawLine of rawLines) {
      const normalizedLine = txn.lineItems[normalizedLineIndex];
      if (this.stringValue(rawLine['DetailType']) !== 'SubTotalLine') {
        normalizedLineIndex += 1;
      }
      if (!normalizedLine) continue;
      if (
        requireProjectMatch &&
        project &&
        !this.lineMatchesProject(normalizedLine, project)
      ) {
        continue;
      }
      if (!this.lineUsesExplicitCostAccount(normalizedLine)) continue;

      const detail = this.asRecord(rawLine['JournalEntryLineDetail']);
      const sign =
        this.stringValue(detail['PostingType']).toLowerCase() === 'credit'
          ? -1
          : 1;
      const allocatedAmount = this.money(normalizedLine.amount * sign);
      details.push({
        basisAmount: normalizedLine.amount,
        projectBasisAmount: normalizedLine.amount,
        allocatedAmount,
        allocationRatio: 1,
        allocationMethod: 'journal_expense_cogs_line',
        category: normalizedLine.category ?? normalizedLine.account,
      });
    }

    if (!details.length)
      return this.emptyAllocation('journal_not_explicit_cost');
    const amount = this.money(
      details.reduce((sum, detail) => sum + detail.allocatedAmount, 0),
    );
    return {
      amount,
      basisAmount: this.money(
        details.reduce((sum, detail) => sum + detail.basisAmount, 0),
      ),
      ratio: 1,
      method: 'journal_expense_cogs_line',
      details,
    };
  }

  private paymentAllocationLines(
    rawPayment: Record<string, unknown>,
    txn: QboNormalizedTransaction,
  ): Array<{
    amount: number;
    linkedTxn: Array<{ txnId: string; txnType: string }>;
  }> {
    const lines = this.asArray(rawPayment['Line'])
      .map((line) => ({
        amount: this.numberValue(line['Amount']),
        linkedTxn: this.extractLinkedTxnList(line['LinkedTxn']),
      }))
      .filter((line) => line.linkedTxn.length > 0);

    if (lines.length) return lines;

    return [
      {
        amount: txn.totalAmount,
        linkedTxn: this.extractLinkedTxnList(rawPayment['LinkedTxn']),
      },
    ];
  }

  private async fetchAttachmentsForDescriptors(
    realmId: string,
    descriptors: TransactionDescriptor[],
    includeTempDownloadUrl: boolean,
  ): Promise<AttachmentFetchResult> {
    const refs = new Map<string, QboAttachmentEntityRef>();
    const descriptorRefs = new Map<string, string[]>();

    for (const descriptor of descriptors) {
      const entityId = descriptor.normalized.entityId;
      if (!entityId) continue;
      const descriptorKey = this.entityKey(descriptor.entityType, entityId);
      const directKey = descriptorKey;
      refs.set(directKey, {
        entityType: descriptor.entityType,
        entityId,
      });
      descriptorRefs.set(descriptorKey, [directKey]);

      for (const linked of descriptor.normalized.linkedTxn) {
        if (!linked.txnId || !linked.txnType) continue;
        const linkedKey = this.entityKey(linked.txnType, linked.txnId);
        refs.set(linkedKey, {
          entityType: linked.txnType,
          entityId: linked.txnId,
        });
        descriptorRefs.set(descriptorKey, [
          ...(descriptorRefs.get(descriptorKey) ?? []),
          linkedKey,
        ]);
      }
    }

    const attachmentResult =
      await this.attachmentsService.getAttachmentsForEntities(
        realmId,
        [...refs.values()],
        { includeTempDownloadUrl },
      );

    const attachmentsByRef = new Map<string, QboNormalizedAttachment[]>();
    const warningsByRef = new Map<string, QboAiWarning[]>();
    for (const entityResult of attachmentResult.byEntity) {
      const key = this.entityKey(
        entityResult.entityRef.entityType,
        entityResult.entityRef.entityId,
      );
      attachmentsByRef.set(key, entityResult.attachments);
      warningsByRef.set(key, entityResult.warnings);
    }

    const byDescriptor = new Map<string, QboNormalizedAttachment[]>();
    const warningsByDescriptor = new Map<string, QboAiWarning[]>();
    for (const [descriptorKey, refKeys] of descriptorRefs.entries()) {
      const byAttachmentId = new Map<string, QboNormalizedAttachment>();
      const descriptorWarnings: QboAiWarning[] = [];
      for (const refKey of refKeys) {
        for (const attachment of attachmentsByRef.get(refKey) ?? []) {
          const id = attachment.attachmentId
            ? `${attachment.attachmentId}:${attachment.linkedEntityType}:${attachment.linkedEntityId}`
            : `${refKey}:${byAttachmentId.size}`;
          byAttachmentId.set(id, attachment);
        }
        descriptorWarnings.push(...(warningsByRef.get(refKey) ?? []));
      }
      byDescriptor.set(descriptorKey, [...byAttachmentId.values()]);
      warningsByDescriptor.set(
        descriptorKey,
        this.normalizer.dedupeWarnings(descriptorWarnings),
      );
    }

    return {
      byDescriptor,
      warningsByDescriptor,
      warnings: attachmentResult.warnings,
      entitiesChecked: attachmentResult.coverage.entitiesChecked,
      attachmentsFound: attachmentResult.coverage.attachmentsFound,
      fallbackUsed: attachmentResult.coverage.fallbackUsed,
    };
  }

  private normalizeWithAttachments(
    entityType: QboCostEntityType,
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[],
  ): QboNormalizedTransaction {
    switch (entityType) {
      case 'Purchase':
        return this.normalizer.normalizePurchase(raw, attachments);
      case 'Bill':
        return this.normalizer.normalizeBill(raw, attachments);
      case 'BillPayment':
        return this.normalizer.normalizeBillPayment(raw, attachments);
      case 'VendorCredit':
        return this.normalizer.normalizeVendorCredit(raw, attachments);
      case 'PurchaseOrder':
        return this.normalizer.normalizePurchaseOrder(raw, attachments);
      case 'JournalEntry':
        return this.normalizer.normalizeJournalEntry(raw, attachments);
    }
  }

  private summarize(transactions: QboJobCostTransaction[]): QboJobCostSummary {
    const summary: QboJobCostSummary = {
      cashOutPaid: 0,
      openAp: 0,
      committedPo: 0,
      vendorCredits: 0,
      adjustedCosts: 0,
      totalJobCost: 0,
    };

    for (const txn of transactions) {
      switch (txn.classification) {
        case 'cash_out_paid':
          summary.cashOutPaid += txn.allocatedAmount;
          break;
        case 'open_ap':
          summary.openAp += txn.allocatedAmount;
          break;
        case 'commitment':
          summary.committedPo += txn.allocatedAmount;
          break;
        case 'credit':
          summary.vendorCredits += txn.allocatedAmount;
          break;
        case 'adjustment':
          summary.adjustedCosts += txn.allocatedAmount;
          break;
      }
    }

    summary.cashOutPaid = this.money(summary.cashOutPaid);
    summary.openAp = this.money(summary.openAp);
    summary.committedPo = this.money(summary.committedPo);
    summary.vendorCredits = this.money(summary.vendorCredits);
    summary.adjustedCosts = this.money(summary.adjustedCosts);
    summary.totalJobCost = this.money(
      summary.cashOutPaid +
        summary.openAp +
        summary.adjustedCosts -
        summary.vendorCredits,
    );

    return summary;
  }

  private buildBreakdown(
    transactions: QboJobCostTransaction[],
    by: 'vendor' | 'category',
  ): QboJobCostBreakdown[] {
    const buckets = new Map<string, QboJobCostBreakdown>();

    for (const txn of transactions) {
      const ref =
        by === 'vendor'
          ? txn.vendor
          : (txn.category ?? txn.account ?? this.firstLineCategory(txn));
      const name = ref?.name || ref?.value || 'Uncategorized';
      const id = ref?.value || undefined;
      const key = `${id ?? ''}:${name}`;
      const bucket =
        buckets.get(key) ??
        ({
          ...(id && { id }),
          name,
          cashOutPaid: 0,
          openAp: 0,
          committedPo: 0,
          vendorCredits: 0,
          adjustedCosts: 0,
          totalJobCost: 0,
          transactionCount: 0,
        } satisfies QboJobCostBreakdown);

      switch (txn.classification) {
        case 'cash_out_paid':
          bucket.cashOutPaid += txn.allocatedAmount;
          break;
        case 'open_ap':
          bucket.openAp += txn.allocatedAmount;
          break;
        case 'commitment':
          bucket.committedPo += txn.allocatedAmount;
          break;
        case 'credit':
          bucket.vendorCredits += txn.allocatedAmount;
          break;
        case 'adjustment':
          bucket.adjustedCosts += txn.allocatedAmount;
          break;
      }
      bucket.transactionCount += 1;
      bucket.totalJobCost =
        bucket.cashOutPaid +
        bucket.openAp +
        bucket.committedPo +
        bucket.adjustedCosts -
        bucket.vendorCredits;
      buckets.set(key, bucket);
    }

    return [...buckets.values()]
      .map((bucket) => ({
        ...bucket,
        cashOutPaid: this.money(bucket.cashOutPaid),
        openAp: this.money(bucket.openAp),
        committedPo: this.money(bucket.committedPo),
        vendorCredits: this.money(bucket.vendorCredits),
        adjustedCosts: this.money(bucket.adjustedCosts),
        totalJobCost: this.money(bucket.totalJobCost),
      }))
      .sort((a, b) => Math.abs(b.totalJobCost) - Math.abs(a.totalJobCost));
  }

  private async buildVendorBreakdown(
    realmId: string,
    transactions: QboJobCostTransaction[],
  ): Promise<{ breakdown: QboJobCostBreakdown[]; warnings: QboAiWarning[] }> {
    const breakdown = this.buildBreakdown(transactions, 'vendor');
    if (!breakdown.length) return { breakdown, warnings: [] };

    try {
      const crmMap = await this.vendorMatching.getVendorCrmMap(realmId);
      const byVendorName = new Map(
        crmMap.entries.map((entry) => [
          this.normalizeName(entry.vendorName),
          entry,
        ]),
      );

      return {
        breakdown: breakdown.map((bucket) => {
          const match =
            (bucket.id ? crmMap.byVendorId[bucket.id] : undefined) ??
            byVendorName.get(this.normalizeName(bucket.name));

          if (!match?.crmCompanyId) return bucket;
          return this.enrichVendorBreakdownBucket(bucket, match);
        }),
        warnings: [],
      };
    } catch {
      return {
        breakdown,
        warnings: [
          this.normalizer.warning(
            'VENDOR_CRM_MAP_FAILED',
            'Unable to enrich vendor breakdown with CRM supplier/subcontractor matches.',
          ),
        ],
      };
    }
  }

  private enrichVendorBreakdownBucket(
    bucket: QboJobCostBreakdown,
    match: QboVendorCrmMapEntry,
  ): QboJobCostBreakdown {
    return {
      ...bucket,
      crmCompanyId: match.crmCompanyId,
      crmCompanyName: match.crmCompanyName,
      ...(match.crmType && { crmType: match.crmType }),
      ...(match.matchConfidence !== undefined && {
        matchConfidence: match.matchConfidence,
      }),
      ...(match.matchMethod && { matchMethod: match.matchMethod }),
      matchStatus: match.matchStatus,
    };
  }

  private async findCustomersForProjectNumber(
    realmId: string,
    projectNumber: string,
  ): Promise<Record<string, unknown>[]> {
    const jobs = (await this.apiService.queryAll(realmId, 'Customer', {
      where: 'Job = true',
    })) as QboCustomerRecord[];
    const jobMatches = jobs.filter((customer) =>
      this.customerMatchesProjectNumber(customer, projectNumber),
    );
    if (jobMatches.length)
      return jobMatches.map((customer) => ({ ...customer }));

    const customers = (await this.apiService.queryAll(
      realmId,
      'Customer',
    )) as QboCustomerRecord[];
    return customers
      .filter((customer) =>
        this.customerMatchesProjectNumber(customer, projectNumber),
      )
      .map((customer) => ({ ...customer }));
  }

  private customerMatchesProjectNumber(
    customer: QboCustomerRecord,
    projectNumber: string,
  ): boolean {
    const normalizedProject = this.normalizeName(projectNumber);
    if (!normalizedProject) return false;
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

  private async fetchCustomerById(
    realmId: string,
    customerId: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.apiService.getCustomer(realmId, customerId);
    return this.apiService.unwrapQboEntity(raw, 'Customer');
  }

  private vendorMatches(
    txn: QboNormalizedTransaction,
    params: QboJobCostingParams,
  ): boolean {
    const vendorId = this.trim(params.vendorId);
    const vendorName = this.normalizeName(params.vendorName);
    if (!vendorId && !vendorName) return true;
    const ref = txn.vendor;
    if (!ref) return false;
    if (vendorId && ref.value === vendorId) return true;
    if (!vendorName) return false;
    const txnName = this.normalizeName(ref.name ?? ref.value);
    return txnName === vendorName || txnName.includes(vendorName);
  }

  private transactionMatchesProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
  ): boolean {
    if (!project || !this.hasProjectIdentity(project)) return false;
    return txn.projectRefs.some((ref) => this.projectRefMatches(ref, project));
  }

  private lineMatchesProject(
    line: QboNormalizedLine,
    project: QboResolvedProjectRef,
  ): boolean {
    return line.projectRefs.some((ref) => this.projectRefMatches(ref, project));
  }

  private projectRefMatches(
    ref: QboRef,
    project: QboResolvedProjectRef,
  ): boolean {
    const idSet = new Set(
      project.refs.map((projectRef) => projectRef.value).filter(Boolean),
    );
    if (ref.value && idSet.has(ref.value)) return true;

    const nameCandidates = [
      project.projectNumber,
      project.displayName,
      ...project.refs.map((projectRef) => projectRef.name),
    ]
      .map((value) => this.normalizeName(value))
      .filter(Boolean);
    const refName = this.normalizeName(ref.name);
    if (!refName) return false;

    return nameCandidates.some((candidate) =>
      this.nameMatchesProject(refName, candidate),
    );
  }

  private hasProjectIdentity(project: QboResolvedProjectRef): boolean {
    return project.refs.some((ref) => ref.value || ref.name);
  }

  private shouldIncludeAllocation(
    allocation: ProjectAllocation,
    requireProjectMatch: boolean,
  ): boolean {
    if (!requireProjectMatch) return allocation.amount !== 0;
    return allocation.amount !== 0 && allocation.method !== 'no_project_match';
  }

  private lineUsesExplicitCostAccount(line: QboNormalizedLine): boolean {
    const accountName = this.normalizeName(
      line.account?.name ?? line.category?.name ?? '',
    );
    return (
      accountName.includes('expense') ||
      accountName.includes('cost of goods') ||
      accountName.includes('cogs') ||
      accountName.includes('job cost') ||
      accountName.includes('materials') ||
      accountName.includes('material') ||
      accountName.includes('subcontract') ||
      accountName.includes('labor') ||
      accountName.includes('labour')
    );
  }

  private isPaidPurchase(raw: Record<string, unknown>): boolean {
    const paymentType = this.stringValue(raw['PaymentType']).toLowerCase();
    return ['check', 'creditcard', 'cash'].includes(paymentType);
  }

  private isClosedPurchaseOrder(txn: QboNormalizedTransaction): boolean {
    return this.normalizeName(txn.status) === 'closed';
  }

  private fullAllocation(amount: number, method: string): ProjectAllocation {
    const rounded = this.money(amount);
    return {
      amount: rounded,
      basisAmount: rounded,
      ratio: rounded === 0 ? 0 : 1,
      method,
      details: [
        {
          basisAmount: rounded,
          projectBasisAmount: rounded,
          allocatedAmount: rounded,
          allocationRatio: rounded === 0 ? 0 : 1,
          allocationMethod: method,
        },
      ],
    };
  }

  private emptyAllocation(method: string): ProjectAllocation {
    return {
      amount: 0,
      basisAmount: 0,
      ratio: 0,
      method,
      details: [],
    };
  }

  private lineBasisAmount(
    lines: QboNormalizedLine[],
    fallbackAmount: number,
  ): number {
    const lineSum = lines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
    return this.money(lineSum || Math.abs(fallbackAmount));
  }

  private ratio(amount: number, basis: number): number {
    if (!basis) return 0;
    return Math.max(0, Math.min(1, Math.abs(amount) / Math.abs(basis)));
  }

  private firstLineCategory(txn: QboJobCostTransaction): QboRef | undefined {
    const line = txn.lineItems.find((item) => item.category ?? item.account);
    return line?.category ?? line?.account;
  }

  private extractLinkedTxnFromRaw(
    raw: Record<string, unknown>,
  ): Array<{ txnId: string; txnType: string }> {
    return [
      ...this.extractLinkedTxnList(raw['LinkedTxn']),
      ...this.asArray(raw['Line']).flatMap((line) =>
        this.extractLinkedTxnList(line['LinkedTxn']),
      ),
    ];
  }

  private extractLinkedTxnList(
    raw: unknown,
  ): Array<{ txnId: string; txnType: string }> {
    return this.asArray(raw).map((linked) => ({
      txnId: this.stringValue(linked['TxnId']),
      txnType: this.stringValue(linked['TxnType']),
    }));
  }

  private entityKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private projectCustomerId(project: QboResolvedProjectRef): string {
    return (
      project.qboCustomerId ||
      project.refs.find((ref) => this.trim(ref.value))?.value ||
      ''
    );
  }

  private buildWhereOptions(...parts: Array<string | undefined>): {
    where?: string;
  } {
    const where = parts
      .map((part) => this.trim(part))
      .filter(Boolean)
      .join(' AND ');
    return where ? { where } : {};
  }

  private isAcceptedEstimate(txn: QboNormalizedTransaction): boolean {
    return this.normalizeName(txn.status) === 'accepted';
  }

  private hasLineWithoutProjectRef(
    txn: QboNormalizedTransaction | QboJobCostTransaction,
  ): boolean {
    if (txn.lineItems.length === 0) return false;
    return txn.lineItems.some((line) => line.projectRefs.length === 0);
  }

  private isProportionalBillPaymentAllocation(
    txn: QboJobCostTransaction,
  ): boolean {
    if (txn.entityType !== 'BillPayment') return false;
    if (txn.allocationRatio > 0 && txn.allocationRatio < 1) return true;
    if (txn.allocationMethod.includes('ratio')) return true;
    return txn.allocationDetails.some(
      (detail) =>
        (detail.allocationRatio > 0 && detail.allocationRatio < 1) ||
        detail.allocationMethod.includes('ratio'),
    );
  }

  private uniqueStrings(values: string[]): string[] {
    const unique = new Set<string>();
    for (const value of values) {
      const normalized = this.trim(value);
      if (normalized) unique.add(normalized);
    }
    return [...unique];
  }

  private emptyProjectResult(
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    warnings: QboAiWarning[],
  ): QboProjectCashOutResult {
    return {
      project,
      summary: this.summarize([]),
      transactions: [],
      vendorBreakdown: [],
      categoryBreakdown: [],
      warnings,
      coverage: {
        entitiesQueried: [],
        dateRange: {
          startDate: params.startDate ?? null,
          endDate: params.endDate ?? null,
        },
        paginationComplete: true,
        attachmentCoverage: {
          requested: params.includeAttachments ?? true,
          entitiesChecked: 0,
          attachmentsFound: 0,
          fallbackUsed: false,
        },
      },
    };
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

  private money(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
