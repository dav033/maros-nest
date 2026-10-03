import {
  QboAiWarning,
  QboNormalizedTransaction,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';
import {
  QboNormalizedAttachment,
  QuickbooksAttachmentsService,
} from '../attachments/quickbooks-attachments.service';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { QuickbooksVendorMatchingService } from '../vendor/quickbooks-vendor-matching.service';
import { QuickbooksJobCostingUtils } from './quickbooks-job-costing.utils';
import {
  AttachmentFetchResult,
  COST_ENTITIES,
  InternalJobCostResult,
  ProjectAllocation,
  QboCostEntityType,
  QboJobCostClassification,
  QboJobCostBreakdown,
  QboJobCostExpenseBreakdown,
  QboJobCostingParams,
  QboJobCostSummary,
  QboJobCostTransaction,
  QboResolvedProjectRef,
  RawCostBundle,
  TransactionDescriptor,
  QboVendorCrmEntry,
} from './quickbooks-job-costing.types';
import {
  QboAccountIndex,
  buildAccountIndex,
  unknownAccountIndex,
} from './quickbooks-job-costing-accounts';
import {
  AllocationContext,
  CostLineFilter,
  allocateBillOpenApEngine,
  allocateBillPaymentEngine,
  allocateJournalEntryEngine,
  allocateTransactionToProjectEngine,
  buildTransactionDescriptorsEngine,
  paymentAllocationLinesEngine,
} from './quickbooks-job-costing-allocation.engine';
import {
  BreakdownContext,
  buildBreakdownEngine,
  buildExpenseBreakdownEngine,
  buildVendorBreakdownEngine,
  enrichVendorBreakdownBucketEngine,
  summarizeEngine,
} from './quickbooks-job-costing-breakdown.aggregation';
import {
  EnrichmentContext,
  fetchAttachmentsForDescriptorsEngine,
  toJobCostTransactionEngine,
} from './quickbooks-job-costing-attachments.enrichment';

export class QuickbooksJobCostingBase extends QuickbooksJobCostingUtils {
  constructor(
    protected readonly apiService: QuickbooksApiService,
    protected readonly normalizer: QuickbooksNormalizerService,
    protected readonly financials: QuickbooksFinancialsService,
    protected readonly attachmentsService: QuickbooksAttachmentsService,
    protected readonly vendorMatching: QuickbooksVendorMatchingService,
  ) {
    super(apiService, financials);
  }

  protected async collectJobCost(
    params: QboJobCostingParams,
    options: { project?: QboResolvedProjectRef; requireProjectMatch: boolean },
  ): Promise<InternalJobCostResult> {
    const realmId = await this.resolveRealmId(params.realmId);
    const includeAttachments = params.includeAttachments ?? true;
    const includeRaw = params.includeRaw ?? false;
    const warnings: QboAiWarning[] = [];
    const rawBundle = await this.fetchCostBundle(realmId, params);
    const accounts = await this.loadAccountIndex(realmId, warnings);
    const billIndex = new Map<string, Record<string, unknown>>();

    for (const bill of rawBundle.bills) {
      const id = this.stringValue(bill['Id']);
      if (id) billIndex.set(id, bill);
    }

    await this.loadLinkedBillsForPayments(realmId, rawBundle.billPayments, billIndex, warnings);

    const descriptors = this.buildTransactionDescriptors(
      rawBundle,
      billIndex,
      options.project,
      options.requireProjectMatch,
      params,
      warnings,
      accounts,
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
    const vendorBreakdown = await this.buildVendorBreakdown(realmId, transactions);
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
      expenseBreakdown: this.buildExpenseBreakdown(transactions),
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

  protected buildTransactionDescriptors(
    rawBundle: RawCostBundle,
    billIndex: Map<string, Record<string, unknown>>,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    params: QboJobCostingParams,
    warnings: QboAiWarning[],
    accounts: QboAccountIndex,
  ): TransactionDescriptor[] {
    const context = this as unknown as AllocationContext;
    return buildTransactionDescriptorsEngine(
      context,
      rawBundle,
      billIndex,
      project,
      requireProjectMatch,
      params,
      warnings,
      accounts,
    );
  }

  /**
   * The chart of accounts, which is what says whether a line is cost at all. Only Id and
   * Classification are needed, and queryAll already read-caches for five minutes — the
   * same window every other QuickBooks read here uses — so this costs one request per
   * five minutes rather than one per job. The chart is reference data that changes when
   * somebody adds an account, and a stale miss is the safe direction anyway: an account
   * the index has never heard of comes back `unknown`, which leaves every figure where it
   * was.
   *
   * A failure returns the empty index rather than throwing. Job cost that cannot classify
   * its accounts is the behaviour this code had before the chart existed; job cost that
   * refuses to answer is worse.
   */
  protected async loadAccountIndex(
    realmId: string,
    warnings: QboAiWarning[],
  ): Promise<QboAccountIndex> {
    try {
      const accounts = await this.apiService.queryAll(realmId, 'Account', {
        select: 'Id, Name, Classification',
        cacheKey: 'job-costing-accounts',
      });
      const rows = accounts.map((account) => this.asRecord(account));
      if (!rows.length) throw new Error('empty chart of accounts');
      return buildAccountIndex(rows);
    } catch {
      warnings.push(
        this.normalizer.warning(
          'CHART_OF_ACCOUNTS_UNAVAILABLE',
          'QuickBooks did not return the chart of accounts, so lines could not be checked against their account type: every line was counted as cost and no deposit was treated as a cost reversal.',
        ),
      );
      return unknownAccountIndex;
    }
  }

  protected descriptor(
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

  protected toJobCostTransaction(
    descriptor: TransactionDescriptor,
    attachments: QboNormalizedAttachment[],
    attachmentWarnings: QboAiWarning[],
    includeRaw: boolean,
    attachmentsRequested: boolean,
  ): QboJobCostTransaction {
    const context = this as unknown as EnrichmentContext;
    return toJobCostTransactionEngine(
      context,
      descriptor,
      attachments,
      attachmentWarnings,
      includeRaw,
      attachmentsRequested,
    );
  }

  protected async fetchCostBundle(
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
      deposits,
    ] = await Promise.all([
      this.apiService.queryAll(realmId, 'Purchase', options),
      this.apiService.queryAll(realmId, 'Bill', options),
      this.apiService.queryAll(realmId, 'BillPayment', options),
      this.apiService.queryAll(realmId, 'VendorCredit', options),
      this.apiService.queryAll(realmId, 'PurchaseOrder', options),
      this.apiService.queryAll(realmId, 'JournalEntry', options),
      this.apiService.queryAll(realmId, 'Deposit', options),
    ]);

    return {
      purchases: purchases.map((item) => this.asRecord(item)),
      bills: bills.map((item) => this.asRecord(item)),
      billPayments: billPayments.map((item) => this.asRecord(item)),
      vendorCredits: vendorCredits.map((item) => this.asRecord(item)),
      purchaseOrders: purchaseOrders.map((item) => this.asRecord(item)),
      journalEntries: journalEntries.map((item) => this.asRecord(item)),
      deposits: deposits.map((item) => this.asRecord(item)),
    };
  }

  protected async loadLinkedBillsForPayments(
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

  protected allocateTransactionToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    isCostLine: CostLineFilter,
  ): ProjectAllocation {
    const context = this as unknown as AllocationContext;
    return allocateTransactionToProjectEngine(
      context,
      txn,
      project,
      requireProjectMatch,
      isCostLine,
    );
  }

  protected allocateBillOpenAp(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    isCostLine: CostLineFilter,
  ): ProjectAllocation {
    const context = this as unknown as AllocationContext;
    return allocateBillOpenApEngine(context, txn, project, requireProjectMatch, isCostLine);
  }

  protected allocateBillPayment(
    rawPayment: Record<string, unknown>,
    txn: QboNormalizedTransaction,
    billIndex: Map<string, Record<string, unknown>>,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    warnings: QboAiWarning[],
    isCostLine: CostLineFilter,
  ): ProjectAllocation {
    const context = this as unknown as AllocationContext;
    return allocateBillPaymentEngine(
      context,
      rawPayment,
      txn,
      billIndex,
      project,
      requireProjectMatch,
      warnings,
      isCostLine,
    );
  }

  protected allocateJournalEntry(
    raw: Record<string, unknown>,
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    accounts: QboAccountIndex,
  ): ProjectAllocation {
    const context = this as unknown as AllocationContext;
    return allocateJournalEntryEngine(
      context,
      raw,
      txn,
      project,
      requireProjectMatch,
      accounts,
    );
  }

  protected paymentAllocationLines(
    rawPayment: Record<string, unknown>,
    txn: QboNormalizedTransaction,
  ): Array<{ amount: number; linkedTxn: Array<{ txnId: string; txnType: string }> }> {
    const context = this as unknown as AllocationContext;
    return paymentAllocationLinesEngine(context, rawPayment, txn);
  }

  protected async fetchAttachmentsForDescriptors(
    realmId: string,
    descriptors: TransactionDescriptor[],
    includeTempDownloadUrl: boolean,
  ): Promise<AttachmentFetchResult> {
    const context = this as unknown as EnrichmentContext;
    return fetchAttachmentsForDescriptorsEngine(
      context,
      realmId,
      descriptors,
      includeTempDownloadUrl,
    );
  }

  protected normalizeWithAttachments(
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
      case 'Deposit':
        return this.normalizer.normalizeDeposit(raw, attachments);
    }
  }

  protected summarize(
    transactions: Array<Pick<QboJobCostTransaction, 'classification' | 'allocatedAmount'>>,
  ): QboJobCostSummary {
    const context = this as unknown as BreakdownContext;
    return summarizeEngine(context, transactions);
  }

  protected buildBreakdown(
    transactions: QboJobCostTransaction[],
    by: 'vendor' | 'category',
  ): QboJobCostBreakdown[] {
    const context = this as unknown as BreakdownContext;
    return buildBreakdownEngine(context, transactions, by);
  }

  /**
   * Por cuenta de gasto y con los proveedores dentro. Aparte de
   * `categoryBreakdown`, que agrupa por la cabecera de la transaccion: ahi la
   * cuenta de un pago es el banco del que salio el dinero.
   */
  protected buildExpenseBreakdown(
    transactions: QboJobCostTransaction[],
  ): QboJobCostExpenseBreakdown[] {
    const context = this as unknown as BreakdownContext;
    return buildExpenseBreakdownEngine(context, transactions);
  }

  protected async buildVendorBreakdown(
    realmId: string,
    transactions: QboJobCostTransaction[],
  ): Promise<{ breakdown: QboJobCostBreakdown[]; warnings: QboAiWarning[] }> {
    const context = this as unknown as BreakdownContext;
    return buildVendorBreakdownEngine(context, realmId, transactions);
  }

  protected enrichVendorBreakdownBucket(
    bucket: QboJobCostBreakdown,
    match: QboVendorCrmEntry,
  ): QboJobCostBreakdown {
    return enrichVendorBreakdownBucketEngine(bucket, match);
  }
}

