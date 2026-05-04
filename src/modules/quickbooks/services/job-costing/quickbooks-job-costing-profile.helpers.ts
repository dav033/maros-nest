import {
  QboAiWarning,
  QboNormalizedTransaction,
  QboRef,
} from '../core/quickbooks-normalizer.service';
import {
  QboAttachmentEntityRef,
  QboNormalizedAttachment,
} from '../attachments/quickbooks-attachments.service';
import {
  QboFullProjectRef,
  QboFullProjectSummary,
  QboJobCostSummary,
  QboJobCostTransaction,
  QboMissingAttachmentTransaction,
  QboProjectAttachmentSummary,
  QboProjectCashIn,
  QboProjectCashOut,
  QboProjectFinancialReports,
  QboResolvedProjectRef,
} from './quickbooks-job-costing.types';
import { FullProjectWarningsInput } from './quickbooks-job-costing-profile.types';

export const emptyProjectCashIn = (): QboProjectCashIn => ({
  estimates: [],
  invoices: [],
  payments: [],
});

export const emptyProjectReports = (): QboProjectFinancialReports => ({
  profitAndLoss: null,
  profitAndLossDetail: null,
  vendorExpenses: null,
  agedPayables: null,
  generalLedgerDetail: null,
});

export const groupCashOut = (
  transactions: QboJobCostTransaction[],
): QboProjectCashOut => ({
  paid: transactions.filter((txn) => txn.classification === 'cash_out_paid'),
  openAp: transactions.filter((txn) => txn.classification === 'open_ap'),
  credits: transactions.filter((txn) => txn.classification === 'credit'),
  commitments: transactions.filter((txn) => txn.classification === 'commitment'),
  adjustments: transactions.filter((txn) => txn.classification === 'adjustment'),
});

export const summarizeProjectAttachments = (
  transactions: Array<QboNormalizedTransaction | QboJobCostTransaction>,
  attachments: QboNormalizedAttachment[],
  byEntity: Array<{
    entityRef: QboAttachmentEntityRef;
    attachments: QboNormalizedAttachment[];
  }>,
  entityKey: (entityType: string, entityId: string) => string,
): QboProjectAttachmentSummary => {
  const byEntityType: Record<string, number> = {};
  const attachmentKeys = new Set<string>();

  for (const attachment of attachments) {
    const type = attachment.linkedEntityType || 'Unknown';
    byEntityType[type] = (byEntityType[type] ?? 0) + 1;
    if (attachment.linkedEntityType && attachment.linkedEntityId) {
      attachmentKeys.add(
        entityKey(attachment.linkedEntityType, attachment.linkedEntityId),
      );
    }
  }

  for (const entity of byEntity) {
    if (entity.attachments.length > 0) {
      attachmentKeys.add(entityKey(entity.entityRef.entityType, entity.entityRef.entityId));
    }
  }

  const missingAttachmentTransactions = transactions
    .filter((txn) => txn.entityId)
    .filter((txn) => {
      if (txn.attachments.length > 0) return false;
      return !attachmentKeys.has(entityKey(txn.entityType, txn.entityId));
    })
    .map((txn) => missingAttachmentTransaction(txn));

  return {
    total: attachments.length,
    byEntityType,
    missingAttachmentTransactions: uniqueMissingAttachmentTransactions(
      missingAttachmentTransactions,
      entityKey,
    ),
  };
};

export const missingAttachmentTransaction = (
  txn: QboNormalizedTransaction | QboJobCostTransaction,
): QboMissingAttachmentTransaction => {
  const missing: QboMissingAttachmentTransaction = {
    entityType: txn.entityType,
    entityId: txn.entityId,
    docNumber: txn.docNumber,
    txnDate: txn.txnDate,
    totalAmount: 'allocatedAmount' in txn ? txn.allocatedAmount : txn.totalAmount,
  };
  if (txn.vendor) missing.vendor = txn.vendor;
  if (txn.customer) missing.customer = txn.customer;
  return missing;
};

export const uniqueMissingAttachmentTransactions = (
  transactions: QboMissingAttachmentTransaction[],
  entityKey: (entityType: string, entityId: string) => string,
): QboMissingAttachmentTransaction[] => {
  const byKey = new Map<string, QboMissingAttachmentTransaction>();
  for (const txn of transactions) {
    byKey.set(entityKey(txn.entityType, txn.entityId), txn);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.txnDate}:${a.entityType}:${a.entityId}`.localeCompare(
      `${b.txnDate}:${b.entityType}:${b.entityId}`,
    ),
  );
};

export const buildFullProjectSummary = (
  cashIn: QboProjectCashIn,
  costs: QboJobCostSummary,
  money: (value: number) => number,
  isAcceptedEstimate: (txn: QboNormalizedTransaction) => boolean,
): QboFullProjectSummary => {
  const estimateAmount = money(
    cashIn.estimates.reduce((sum, txn) => sum + txn.totalAmount, 0),
  );
  const acceptedEstimateAmount = money(
    cashIn.estimates
      .filter((txn) => isAcceptedEstimate(txn))
      .reduce((sum, txn) => sum + txn.totalAmount, 0),
  );
  const invoicedAmount = money(
    cashIn.invoices.reduce((sum, txn) => sum + txn.totalAmount, 0),
  );
  const customerPaymentsReceived = money(
    cashIn.payments.reduce((sum, txn) => sum + txn.totalAmount, 0),
  );
  const customerOutstandingBalance = money(
    cashIn.invoices.reduce((sum, txn) => sum + (txn.openBalance ?? 0), 0),
  );
  const contractValue =
    acceptedEstimateAmount > 0
      ? acceptedEstimateAmount
      : estimateAmount > 0
        ? estimateAmount
        : invoicedAmount;
  const cashOutPaid = money(costs.cashOutPaid);
  const openBills = money(costs.openAp);
  const committedPurchaseOrders = money(costs.committedPo);
  const vendorCredits = money(costs.vendorCredits);
  const adjustedCosts = money(costs.adjustedCosts);
  const totalJobCost = money(cashOutPaid + openBills + adjustedCosts - vendorCredits);
  const grossProfit = money(invoicedAmount - totalJobCost);
  const grossMarginPercent =
    invoicedAmount === 0 ? 0 : money((grossProfit / invoicedAmount) * 100);

  return {
    estimateAmount,
    contractValue: money(contractValue),
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
    cashPositionVsCosts: money(customerPaymentsReceived - cashOutPaid),
  };
};

export const buildFullProjectWarnings = (
  input: FullProjectWarningsInput,
  warning: (code: string, message: string) => QboAiWarning,
  hasLineWithoutProjectRef: (
    txn: QboNormalizedTransaction | QboJobCostTransaction,
  ) => boolean,
  isProportionalBillPaymentAllocation: (txn: QboJobCostTransaction) => boolean,
): QboAiWarning[] => {
  const warnings: QboAiWarning[] = [];

  if (input.allTransactions.some((txn) => hasLineWithoutProjectRef(txn))) {
    warnings.push(
      warning(
        'missing_project_ref_on_some_lines',
        'Some transactions include lines without a project reference, so those lines were not counted unless the transaction itself matched the project.',
      ),
    );
  }

  if (input.attachmentSummary.missingAttachmentTransactions.length > 0) {
    warnings.push(
      warning(
        'transactions_without_attachments',
        'Some project transactions do not have QuickBooks attachment metadata.',
      ),
    );
  }

  if (
    input.cashOutTransactions.some((txn) =>
      isProportionalBillPaymentAllocation(txn),
    )
  ) {
    warnings.push(
      warning(
        'bill_payments_allocated_proportionally',
        'Some bill payments were allocated proportionally because the payment covers bills or lines beyond this project.',
      ),
    );
  }

  if (input.reportWarningsPresent || input.reportChunks.length > 1) {
    warnings.push(
      warning(
        'reports_limited_or_chunked',
        'Some project reports were limited or split into smaller date windows.',
      ),
    );
  }

  if (input.hasDateFilter) {
    warnings.push(
      warning(
        'incomplete_due_to_date_filter',
        'This profile only includes transactions inside the requested date range.',
      ),
    );
  }

  if (
    input.vendorBreakdown.some(
      (bucket) =>
        bucket.name !== 'Uncategorized' &&
        !bucket.crmCompanyId &&
        !bucket.matchConfidence,
    )
  ) {
    warnings.push(
      warning(
        'no_qbo_vendor_match_for_crm_subcontractor',
        'Some QuickBooks vendors in this project are not linked to a CRM supplier or subcontractor.',
      ),
    );
  }

  return warnings;
};

export const toFullProjectRef = (
  project: QboResolvedProjectRef,
  params: { projectNumber?: string; qboCustomerId?: string },
  trim: (value: unknown) => string,
  projectCustomerId: (projectRef: QboResolvedProjectRef) => string,
): QboFullProjectRef => {
  const qboCustomerId = projectCustomerId(project) || trim(params.qboCustomerId);
  const customerName =
    project.displayName || project.refs.find((ref) => trim(ref.name))?.name || '';

  return {
    projectNumber: project.projectNumber ?? trim(params.projectNumber),
    qboCustomerId,
    customerName,
    foundInQuickBooks: project.found === true && !!qboCustomerId,
    crmProjectId: null,
    crmLeadId: null,
  };
};

export const firstAvailableRef = (...refs: Array<QboRef | undefined>): QboRef | undefined =>
  refs.find((ref) => ref?.value || ref?.name);

