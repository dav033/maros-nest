import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  QboAiWarning,
  QboNormalizedTransaction,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';
import { QuickbooksAttachmentsService } from '../attachments/quickbooks-attachments.service';
import { QuickbooksReportsService } from '../reports/quickbooks-reports.service';
import {
  QboJobCostingParams,
  QboProjectCashIn,
  QboProjectJobCostSummaryResult,
  QboResolvedProjectRef,
} from './quickbooks-job-costing.types';
import {
  buildFullProjectSummary,
  buildFullProjectWarnings,
  emptyProjectCashIn,
  emptyProjectReports,
  groupCashOut,
  summarizeProjectAttachments,
  toFullProjectRef,
} from './quickbooks-job-costing-profile.helpers';
import {
  BuildProjectJobCostSummaryInput,
  EmptyFullProjectResultInput,
  ProjectAttachmentSummaryResult,
  ProjectCashInFetchResult,
  ProjectReportsFetchResult,
  QuickbooksJobCostingProfileContext,
} from './quickbooks-job-costing-profile.types';
import { CashInEntityName } from './quickbooks-job-costing.types';

const PROJECT_REPORT_ENTITIES = [
  'Report:ProfitAndLoss',
  'Report:ProfitAndLossDetail',
  'Report:VendorExpenses',
  'Report:AgedPayables',
];

@Injectable()
export class QuickbooksJobCostingProjectProfileService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly attachmentsService: QuickbooksAttachmentsService,
    private readonly reports: QuickbooksReportsService,
  ) {}

  async buildProjectJobCostSummary(
    input: BuildProjectJobCostSummaryInput,
  ): Promise<QboProjectJobCostSummaryResult> {
    const { realmId, project, params, jobCost, context } = input;
    const cashInResult = await this.fetchProjectCashIn(
      realmId,
      project,
      params,
      context,
    );
    const reportResult = await this.fetchProjectReports(
      realmId,
      project,
      params,
      context,
    );
    const attachmentResult = await this.buildProjectAttachmentSummary(
      realmId,
      project,
      params,
      cashInResult.cashIn,
      jobCost.transactions,
      context,
    );

    const cashOut = groupCashOut(jobCost.transactions);
    const summary = buildFullProjectSummary(
      cashInResult.cashIn,
      jobCost.summary,
      (value) => context.money(value),
      (txn) => context.isAcceptedEstimate(txn),
    );
    const profileWarnings = buildFullProjectWarnings(
      {
        hasDateFilter: !!(params.startDate || params.endDate),
        allTransactions: [
          ...cashInResult.cashIn.estimates,
          ...cashInResult.cashIn.invoices,
          ...cashInResult.cashIn.payments,
          ...jobCost.transactions,
        ],
        cashOutTransactions: jobCost.transactions,
        vendorBreakdown: jobCost.vendorBreakdown,
        attachmentSummary: attachmentResult.attachments,
        reportChunks: reportResult.reportChunks,
        reportWarningsPresent: reportResult.warnings.length > 0,
      },
      (code, message) => this.normalizer.warning(code, message),
      (txn) => context.hasLineWithoutProjectRef(txn),
      (txn) => context.isProportionalBillPaymentAllocation(txn),
    );

    return {
      project: toFullProjectRef(
        project,
        params,
        (value) => context.trim(value),
        (projectRef) => context.projectCustomerId(projectRef),
      ),
      summary,
      cashIn: cashInResult.cashIn,
      cashOut,
      vendorBreakdown: jobCost.vendorBreakdown,
      categoryBreakdown: jobCost.categoryBreakdown,
      attachments: attachmentResult.attachments,
      reports: reportResult.reports,
      coverage: {
        realmId,
        dateRange: {
          startDate: params.startDate ?? null,
          endDate: params.endDate ?? null,
        },
        entitiesQueried: context.uniqueStrings([
          ...jobCost.coverage.entitiesQueried,
          ...cashInResult.entitiesQueried,
          ...attachmentResult.entitiesQueried,
          ...reportResult.entitiesQueried,
        ]),
        paginationComplete: jobCost.coverage.paginationComplete,
        reportChunks: reportResult.reportChunks,
        generatedAt: new Date().toISOString(),
      },
      warnings: this.normalizer.dedupeWarnings([
        ...jobCost.warnings,
        ...cashInResult.warnings,
        ...attachmentResult.warnings,
        ...reportResult.warnings,
        ...profileWarnings,
      ]),
    };
  }

  emptyFullProjectResult(
    input: EmptyFullProjectResultInput,
  ): QboProjectJobCostSummaryResult {
    const { realmId, project, params, warnings, context } = input;
    return {
      project: toFullProjectRef(
        project,
        params,
        (value) => context.trim(value),
        (projectRef) => context.projectCustomerId(projectRef),
      ),
      summary: buildFullProjectSummary(
        emptyProjectCashIn(),
        {
          cashOutPaid: 0,
          openAp: 0,
          committedPo: 0,
          vendorCredits: 0,
          adjustedCosts: 0,
          totalJobCost: 0,
        },
        (value) => context.money(value),
        (txn) => context.isAcceptedEstimate(txn),
      ),
      cashIn: emptyProjectCashIn(),
      cashOut: groupCashOut([]),
      vendorBreakdown: [],
      categoryBreakdown: [],
      attachments: {
        total: 0,
        byEntityType: {},
        missingAttachmentTransactions: [],
      },
      reports: emptyProjectReports(),
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

  private async fetchProjectCashIn(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    context: QuickbooksJobCostingProfileContext,
  ): Promise<ProjectCashInFetchResult> {
    const warnings: QboAiWarning[] = [];
    const customerId = context.projectCustomerId(project);
    const dateWhere = this.apiService.buildDateWhereClause(params).where;
    const customerWhere = customerId
      ? `CustomerRef = '${this.apiService.escapeQboString(customerId)}'`
      : undefined;
    const customerScopedOptions = context.buildWhereOptions(customerWhere, dateWhere);
    const paymentOptions = context.buildWhereOptions(dateWhere);

    const [estimateRows, invoiceRows, paymentRows] = await Promise.all([
      this.queryCashInEntity(
        realmId,
        'Estimate',
        customerScopedOptions,
        warnings,
        context,
      ),
      this.queryCashInEntity(
        realmId,
        'Invoice',
        customerScopedOptions,
        warnings,
        context,
      ),
      this.queryCashInEntity(realmId, 'Payment', paymentOptions, warnings, context),
    ]);

    const estimates = estimateRows
      .map((row) => this.normalizer.normalizeEstimate(row))
      .filter((txn) =>
        this.cashInBelongsToProject(txn, project, customerId, context),
      );
    const invoices = invoiceRows
      .map((row) => this.normalizer.normalizeInvoice(row))
      .filter((txn) =>
        this.cashInBelongsToProject(txn, project, customerId, context),
      );
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
          context,
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
    entityName: CashInEntityName,
    options: { where?: string },
    warnings: QboAiWarning[],
    context: QuickbooksJobCostingProfileContext,
  ): Promise<Record<string, unknown>[]> {
    try {
      const rows = await this.apiService.queryAll(realmId, entityName, options);
      return rows.map((row) => context.asRecord(row));
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
    customerId: string | undefined,
    context: QuickbooksJobCostingProfileContext,
  ): boolean {
    if (customerId && txn.customer?.value === customerId) return true;
    return context.transactionMatchesProject(txn, project);
  }

  private paymentBelongsToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef,
    customerId: string | undefined,
    projectInvoiceIds: Set<string>,
    context: QuickbooksJobCostingProfileContext,
  ): boolean {
    if (
      txn.linkedTxn.some(
        (linked) =>
          linked.txnType === 'Invoice' && projectInvoiceIds.has(linked.txnId),
      )
    ) {
      return true;
    }
    return this.cashInBelongsToProject(txn, project, customerId, context);
  }

  private async buildProjectAttachmentSummary(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    cashIn: QboProjectCashIn,
    cashOutTransactions: BuildProjectJobCostSummaryInput['jobCost']['transactions'],
    context: QuickbooksJobCostingProfileContext,
  ): Promise<ProjectAttachmentSummaryResult> {
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
      const projectAttachments = await this.attachmentsService.getProjectAttachments({
        realmId,
        projectNumber: project.projectNumber,
        qboCustomerId: context.projectCustomerId(project),
        startDate: params.startDate,
        endDate: params.endDate,
        includeTempDownloadUrl: false,
      });

      return {
        attachments: summarizeProjectAttachments(
          transactions,
          projectAttachments.attachments,
          projectAttachments.byEntity,
          (entityType, entityId) => context.entityKey(entityType, entityId),
        ),
        warnings: projectAttachments.warnings,
        entitiesQueried: ['Attachable'],
      };
    } catch {
      const attachments = summarizeProjectAttachments(
        transactions,
        [],
        [],
        (entityType, entityId) => context.entityKey(entityType, entityId),
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

  private async fetchProjectReports(
    realmId: string,
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    context: QuickbooksJobCostingProfileContext,
  ): Promise<ProjectReportsFetchResult> {
    const emptyReports = emptyProjectReports();
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
        customerId: context.projectCustomerId(project),
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
        entitiesQueried: PROJECT_REPORT_ENTITIES,
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
        entitiesQueried: PROJECT_REPORT_ENTITIES,
      };
    }
  }
}
