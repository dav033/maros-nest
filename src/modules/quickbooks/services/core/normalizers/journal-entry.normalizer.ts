import { QboNormalizedTransaction } from '../quickbooks-normalizer.types';
import {
  a,
  buildProjectWarnings,
  buildRawRef,
  collectProjectRefs,
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

export function normalizeJournalEntry(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboNormalizedTransaction {
  const lineItems = normalizeLines(a(raw['Line']));
  const customer = extractRef(raw['CustomerRef']);
  const account = firstLineAccount(lineItems);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const result: QboNormalizedTransaction = {
    source: 'quickbooks',
    direction: 'adjustment',
    entityType: 'JournalEntry',
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
    rawRef: buildRawRef('JournalEntry', raw),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (customer) result.customer = customer;
  if (account) {
    result.account = account;
    result.category = account;
  }
  return result;
}
