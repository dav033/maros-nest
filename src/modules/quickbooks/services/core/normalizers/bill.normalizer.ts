import { QboNormalizedTransaction } from '../quickbooks-normalizer.types';
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
  firstLineAccount,
  n,
  normalizeAttachments,
  normalizeLines,
  s,
} from '../quickbooks-normalizer.utils';

export function normalizeBill(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboNormalizedTransaction {
  const lineItems = normalizeLines(a(raw['Line']));
  const customer = extractRef(raw['CustomerRef']);
  const vendor = extractRef(raw['VendorRef']);
  const account = extractRef(raw['APAccountRef']) ?? firstLineAccount(lineItems);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboNormalizedTransaction = {
    source: 'quickbooks',
    direction: 'ap_open',
    entityType: 'Bill',
    entityId: s(raw['Id']),
    docNumber: s(raw['DocNumber']),
    txnDate: s(raw['TxnDate']),
    totalAmount: n(raw['TotalAmt']),
    openBalance: n(raw['Balance']),
    projectRefs,
    lineItems,
    linkedTxn: extractLinkedTxn(raw),
    memo: extractMemo(raw),
    description: extractDescription(raw),
    attachments: normalizeAttachments(attachments),
    rawRef: buildRawRef('Bill', raw),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (raw['DueDate']) result.dueDate = s(raw['DueDate']);
  if (customer) result.customer = customer;
  if (vendor) result.vendor = vendor;
  if (account) {
    result.account = account;
    result.category = account;
  }
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
