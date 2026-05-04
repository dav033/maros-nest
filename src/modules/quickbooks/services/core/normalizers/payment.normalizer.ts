import { QboCashInTransaction } from '../quickbooks-normalizer.types';
import {
  a,
  buildProjectWarnings,
  buildRawRef,
  collectProjectRefs,
  deriveBillableStatus,
  extractDescription,
  extractLinkedTxn,
  extractMemo,
  extractRef,
  n,
  normalizeAttachments,
  normalizeLines,
  s,
} from '../quickbooks-normalizer.utils';

export function normalizePayment(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboCashInTransaction {
  const lineItems = normalizeLines(a(raw['Line']));
  const customer = extractRef(raw['CustomerRef']);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboCashInTransaction = {
    source: 'quickbooks',
    direction: 'cash_in',
    entityType: 'Payment',
    entityId: s(raw['Id']),
    docNumber: s(raw['DocNumber']),
    txnDate: s(raw['TxnDate']),
    totalAmount: n(raw['TotalAmt']),
    projectRefs,
    lineItems,
    linkedTxn: extractLinkedTxn(raw),
    memo: extractMemo(raw),
    description: extractDescription(raw),
    attachments: normalizeAttachments(attachments),
    rawRef: buildRawRef('Payment', raw),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (customer) result.customer = customer;
  if (raw['UnappliedAmt'] !== undefined) result.openBalance = n(raw['UnappliedAmt']);
  const depositAccount = extractRef(raw['DepositToAccountRef']);
  if (depositAccount) result.account = depositAccount;
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
