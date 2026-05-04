import {
  QboAiWarning,
  QboNormalizedTransaction,
} from '../core/quickbooks-normalizer.service';
import {
  ProjectAllocation,
  QboJobCostAllocationDetail,
  QboJobCostingParams,
  QboResolvedProjectRef,
  RawCostBundle,
  TransactionDescriptor,
} from './quickbooks-job-costing.types';

export type AllocationContext = {
  normalizer: {
    normalizePurchase(raw: Record<string, unknown>): QboNormalizedTransaction;
    normalizeBill(raw: Record<string, unknown>): QboNormalizedTransaction;
    normalizeBillPayment(raw: Record<string, unknown>): QboNormalizedTransaction;
    normalizeVendorCredit(raw: Record<string, unknown>): QboNormalizedTransaction;
    normalizePurchaseOrder(raw: Record<string, unknown>): QboNormalizedTransaction;
    normalizeJournalEntry(raw: Record<string, unknown>): QboNormalizedTransaction;
    warning(code: string, message: string): QboAiWarning;
  };
  vendorMatches(
    txn: QboNormalizedTransaction,
    params: QboJobCostingParams,
  ): boolean;
  shouldIncludeAllocation(
    allocation: ProjectAllocation,
    requireProjectMatch: boolean,
  ): boolean;
  isPaidPurchase(raw: Record<string, unknown>): boolean;
  isClosedPurchaseOrder(txn: QboNormalizedTransaction): boolean;
  allocateTransactionToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
  ): ProjectAllocation;
  allocateBillOpenAp(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
  ): ProjectAllocation;
  allocateBillPayment(
    rawPayment: Record<string, unknown>,
    txn: QboNormalizedTransaction,
    billIndex: Map<string, Record<string, unknown>>,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    warnings: QboAiWarning[],
  ): ProjectAllocation;
  allocateJournalEntry(
    raw: Record<string, unknown>,
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
  ): ProjectAllocation;
  transactionMatchesProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
  ): boolean;
  descriptor(
    entityType: TransactionDescriptor['entityType'],
    raw: Record<string, unknown>,
    normalized: QboNormalizedTransaction,
    classification: TransactionDescriptor['classification'],
    allocation: ProjectAllocation,
  ): TransactionDescriptor;
  stringValue(value: unknown): string;
  money(value: number): number;
  fullAllocation(amount: number, method: ProjectAllocation['method']): ProjectAllocation;
  lineBasisAmount(lineItems: QboNormalizedTransaction['lineItems'], totalAmount: number): number;
  lineMatchesProject(line: QboNormalizedTransaction['lineItems'][number], project: QboResolvedProjectRef): boolean;
  ratio(value: number, total: number): number;
  emptyAllocation(method: ProjectAllocation['method']): ProjectAllocation;
  asArray(value: unknown): Record<string, unknown>[];
  lineUsesExplicitCostAccount(line: QboNormalizedTransaction['lineItems'][number]): boolean;
  asRecord(value: unknown): Record<string, unknown>;
  extractLinkedTxnList(value: unknown): Array<{ txnId: string; txnType: string }>;
  paymentAllocationLines(
    rawPayment: Record<string, unknown>,
    txn: QboNormalizedTransaction,
  ): Array<{ amount: number; linkedTxn: Array<{ txnId: string; txnType: string }> }>;
  numberValue(value: unknown): number;
};

export function buildTransactionDescriptorsEngine(
  ctx: AllocationContext,
  rawBundle: RawCostBundle,
  billIndex: Map<string, Record<string, unknown>>,
  project: QboResolvedProjectRef | undefined,
  requireProjectMatch: boolean,
  params: QboJobCostingParams,
  warnings: QboAiWarning[],
): TransactionDescriptor[] {
  const descriptors: TransactionDescriptor[] = [];

  for (const raw of rawBundle.purchases) {
    const normalized = ctx.normalizer.normalizePurchase(raw);
    if (!ctx.vendorMatches(normalized, params)) continue;
    const allocation = ctx.allocateTransactionToProject(normalized, project, requireProjectMatch);
    if (!ctx.shouldIncludeAllocation(allocation, requireProjectMatch)) continue;
    if (!ctx.isPaidPurchase(raw)) {
      warnings.push(
        ctx.normalizer.warning(
          'PURCHASE_PAYMENT_TYPE_NOT_INCLUDED',
          `Purchase ${normalized.entityId} has payment type '${ctx.stringValue(raw['PaymentType'])}' and was not counted as paid cash out.`,
        ),
      );
      continue;
    }
    descriptors.push(ctx.descriptor('Purchase', raw, normalized, 'cash_out_paid', allocation));
  }

  for (const raw of rawBundle.bills) {
    const normalized = ctx.normalizer.normalizeBill(raw);
    if (!ctx.vendorMatches(normalized, params)) continue;
    const allocation = ctx.allocateBillOpenAp(normalized, project, requireProjectMatch);
    if (!ctx.shouldIncludeAllocation(allocation, requireProjectMatch)) continue;
    if ((normalized.openBalance ?? 0) <= 0) continue;
    descriptors.push(ctx.descriptor('Bill', raw, normalized, 'open_ap', allocation));
  }

  for (const raw of rawBundle.billPayments) {
    const normalized = ctx.normalizer.normalizeBillPayment(raw);
    if (!ctx.vendorMatches(normalized, params)) continue;
    const allocation = ctx.allocateBillPayment(
      raw,
      normalized,
      billIndex,
      project,
      requireProjectMatch,
      warnings,
    );
    if (!ctx.shouldIncludeAllocation(allocation, requireProjectMatch)) continue;
    descriptors.push(ctx.descriptor('BillPayment', raw, normalized, 'cash_out_paid', allocation));
  }

  for (const raw of rawBundle.vendorCredits) {
    const normalized = ctx.normalizer.normalizeVendorCredit(raw);
    if (!ctx.vendorMatches(normalized, params)) continue;
    const allocation = ctx.allocateTransactionToProject(normalized, project, requireProjectMatch);
    if (!ctx.shouldIncludeAllocation(allocation, requireProjectMatch)) continue;
    descriptors.push(ctx.descriptor('VendorCredit', raw, normalized, 'credit', allocation));
  }

  for (const raw of rawBundle.purchaseOrders) {
    const normalized = ctx.normalizer.normalizePurchaseOrder(raw);
    if (!ctx.vendorMatches(normalized, params)) continue;
    if (ctx.isClosedPurchaseOrder(normalized)) continue;
    const allocation = ctx.allocateTransactionToProject(normalized, project, requireProjectMatch);
    if (!ctx.shouldIncludeAllocation(allocation, requireProjectMatch)) continue;
    descriptors.push(ctx.descriptor('PurchaseOrder', raw, normalized, 'commitment', allocation));
  }

  for (const raw of rawBundle.journalEntries) {
    const normalized = ctx.normalizer.normalizeJournalEntry(raw);
    const allocation = ctx.allocateJournalEntry(raw, normalized, project, requireProjectMatch);
    if (!ctx.shouldIncludeAllocation(allocation, requireProjectMatch)) {
      if (ctx.transactionMatchesProject(normalized, project)) {
        warnings.push(
          ctx.normalizer.warning(
            'JOURNAL_ENTRY_NOT_EXPLICIT_COST',
            `JournalEntry ${normalized.entityId} matched the project but did not explicitly affect an expense or COGS account.`,
          ),
        );
      }
      continue;
    }
    descriptors.push(ctx.descriptor('JournalEntry', raw, normalized, 'adjustment', allocation));
  }

  return descriptors.sort((a, b) =>
    `${a.normalized.txnDate}:${a.normalized.entityType}:${a.normalized.entityId}`.localeCompare(
      `${b.normalized.txnDate}:${b.normalized.entityType}:${b.normalized.entityId}`,
    ),
  );
}

export function allocateTransactionToProjectEngine(
  ctx: AllocationContext,
  txn: QboNormalizedTransaction,
  project: QboResolvedProjectRef | undefined,
  requireProjectMatch: boolean,
): ProjectAllocation {
  if (!requireProjectMatch || !project) {
    return ctx.fullAllocation(txn.totalAmount, 'full_transaction');
  }

  const lineBasis = ctx.lineBasisAmount(txn.lineItems, txn.totalAmount);
  const matchingLines = txn.lineItems.filter((line) => ctx.lineMatchesProject(line, project));

  if (matchingLines.length) {
    const amount = matchingLines.reduce((sum, line) => sum + line.amount, 0);
    return {
      amount: ctx.money(amount),
      basisAmount: lineBasis,
      ratio: ctx.ratio(amount, lineBasis),
      method: 'project_line_amount',
      details: matchingLines.map((line) => ({
        basisAmount: lineBasis,
        projectBasisAmount: ctx.money(line.amount),
        allocatedAmount: ctx.money(line.amount),
        allocationRatio: ctx.ratio(line.amount, lineBasis),
        allocationMethod: 'project_line_amount',
        category: line.category ?? line.account,
      })),
    };
  }

  if (ctx.transactionMatchesProject(txn, project)) {
    return ctx.fullAllocation(txn.totalAmount, 'project_header_full');
  }

  return ctx.emptyAllocation('no_project_match');
}

export function allocateBillOpenApEngine(
  ctx: AllocationContext,
  txn: QboNormalizedTransaction,
  project: QboResolvedProjectRef | undefined,
  requireProjectMatch: boolean,
): ProjectAllocation {
  if ((txn.openBalance ?? 0) <= 0) return ctx.emptyAllocation('bill_closed');
  const base = ctx.allocateTransactionToProject(txn, project, requireProjectMatch);
  if (base.amount === 0 && requireProjectMatch) return base;
  const openAmount = ctx.money((txn.openBalance ?? 0) * base.ratio);
  return {
    amount: openAmount,
    basisAmount: txn.openBalance ?? 0,
    ratio: base.ratio,
    method: base.method === 'project_line_amount' ? 'open_ap_project_line_ratio' : 'open_ap_full',
    details: base.details.length
      ? base.details.map((detail) => ({
          ...detail,
          allocatedAmount: ctx.money((txn.openBalance ?? 0) * detail.allocationRatio),
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

export function allocateBillPaymentEngine(
  ctx: AllocationContext,
  rawPayment: Record<string, unknown>,
  txn: QboNormalizedTransaction,
  billIndex: Map<string, Record<string, unknown>>,
  project: QboResolvedProjectRef | undefined,
  requireProjectMatch: boolean,
  warnings: QboAiWarning[],
): ProjectAllocation {
  if (!requireProjectMatch || !project) {
    return ctx.fullAllocation(txn.totalAmount, 'linked_bill_full');
  }

  const details: QboJobCostAllocationDetail[] = [];
  const paymentLines = ctx.paymentAllocationLines(rawPayment, txn);

  for (const paymentLine of paymentLines) {
    const linkedBills = paymentLine.linkedTxn.filter(
      (linked) => linked.txnType === 'Bill' && linked.txnId,
    );
    if (!linkedBills.length) continue;

    const amountPerBill =
      linkedBills.length > 0 ? paymentLine.amount / linkedBills.length : paymentLine.amount;

    for (const linked of linkedBills) {
      const billRaw = billIndex.get(linked.txnId);
      if (!billRaw) {
        warnings.push(
          ctx.normalizer.warning(
            'LINKED_BILL_NOT_AVAILABLE',
            `BillPayment ${txn.entityId} links to Bill ${linked.txnId}, but the bill was not available for allocation.`,
          ),
        );
        continue;
      }
      const bill = ctx.normalizer.normalizeBill(billRaw);
      const billAllocation = ctx.allocateTransactionToProject(bill, project, true);
      if (billAllocation.amount === 0) continue;

      const allocatedAmount = ctx.money(amountPerBill * billAllocation.ratio);
      details.push({
        linkedTxnId: linked.txnId,
        linkedTxnType: linked.txnType,
        sourceEntityType: 'Bill',
        sourceEntityId: bill.entityId,
        basisAmount: ctx.money(amountPerBill),
        projectBasisAmount: billAllocation.amount,
        allocatedAmount,
        allocationRatio: billAllocation.ratio,
        allocationMethod:
          billAllocation.ratio === 1 ? 'linked_bill_full' : 'linked_bill_project_line_ratio',
        category: bill.category ?? bill.account,
      });
    }
  }

  if (!details.length) return ctx.emptyAllocation('no_linked_project_bill');

  const amount = ctx.money(details.reduce((sum, detail) => sum + detail.allocatedAmount, 0));
  const basisAmount = ctx.money(details.reduce((sum, detail) => sum + detail.basisAmount, 0));
  return {
    amount,
    basisAmount,
    ratio: ctx.ratio(amount, basisAmount),
    method: details.some(
      (detail) => detail.allocationMethod === 'linked_bill_project_line_ratio',
    )
      ? 'linked_bill_project_line_ratio'
      : 'linked_bill_full',
    details,
  };
}

export function allocateJournalEntryEngine(
  ctx: AllocationContext,
  raw: Record<string, unknown>,
  txn: QboNormalizedTransaction,
  project: QboResolvedProjectRef | undefined,
  requireProjectMatch: boolean,
): ProjectAllocation {
  const rawLines = ctx.asArray(raw['Line']);
  const details: QboJobCostAllocationDetail[] = [];
  let normalizedLineIndex = 0;

  for (const rawLine of rawLines) {
    const normalizedLine = txn.lineItems[normalizedLineIndex];
    if (ctx.stringValue(rawLine['DetailType']) !== 'SubTotalLine') {
      normalizedLineIndex += 1;
    }
    if (!normalizedLine) continue;
    if (requireProjectMatch && project && !ctx.lineMatchesProject(normalizedLine, project)) {
      continue;
    }
    if (!ctx.lineUsesExplicitCostAccount(normalizedLine)) continue;

    const detail = ctx.asRecord(rawLine['JournalEntryLineDetail']);
    const sign = ctx.stringValue(detail['PostingType']).toLowerCase() === 'credit' ? -1 : 1;
    const allocatedAmount = ctx.money(normalizedLine.amount * sign);
    details.push({
      basisAmount: normalizedLine.amount,
      projectBasisAmount: normalizedLine.amount,
      allocatedAmount,
      allocationRatio: 1,
      allocationMethod: 'journal_expense_cogs_line',
      category: normalizedLine.category ?? normalizedLine.account,
    });
  }

  if (!details.length) return ctx.emptyAllocation('journal_not_explicit_cost');
  const amount = ctx.money(details.reduce((sum, detail) => sum + detail.allocatedAmount, 0));
  return {
    amount,
    basisAmount: ctx.money(details.reduce((sum, detail) => sum + detail.basisAmount, 0)),
    ratio: 1,
    method: 'journal_expense_cogs_line',
    details,
  };
}

export function paymentAllocationLinesEngine(
  ctx: AllocationContext,
  rawPayment: Record<string, unknown>,
  txn: QboNormalizedTransaction,
): Array<{ amount: number; linkedTxn: Array<{ txnId: string; txnType: string }> }> {
  const lines = ctx
    .asArray(rawPayment['Line'])
    .map((line) => ({
      amount: ctx.numberValue(line['Amount']),
      linkedTxn: ctx.extractLinkedTxnList(line['LinkedTxn']),
    }))
    .filter((line) => line.linkedTxn.length > 0);

  if (lines.length) return lines;

  return [
    {
      amount: txn.totalAmount,
      linkedTxn: ctx.extractLinkedTxnList(rawPayment['LinkedTxn']),
    },
  ];
}

