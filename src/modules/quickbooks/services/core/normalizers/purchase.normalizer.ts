import { QboCashOutTransaction } from '../quickbooks-normalizer.types';
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

export function normalizePurchase(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboCashOutTransaction {
  const lineItems = normalizeLines(a(raw['Line']));
  const customer = extractRef(raw['CustomerRef']);
  const vendor = extractRef(raw['EntityRef']);
  const account = extractRef(raw['AccountRef']);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboCashOutTransaction = {
    source: 'quickbooks',
    direction: 'cash_out',
    entityType: 'Purchase',
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
    rawRef: buildRawRef('Purchase', raw),
    status: s(raw['PaymentType']),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (customer) result.customer = customer;
  if (vendor) result.vendor = vendor;
  if (account) {
    result.account = account;
    result.category = account;
  }
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
