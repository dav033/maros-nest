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
  n,
  normalizeAttachments,
  normalizeLines,
  s,
} from '../quickbooks-normalizer.utils';

export function normalizeEstimate(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboNormalizedTransaction {
  const lineItems = normalizeLines(a(raw['Line']));
  const customer = extractRef(raw['CustomerRef']);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboNormalizedTransaction = {
    source: 'quickbooks',
    direction: 'commitment',
    entityType: 'Estimate',
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
    rawRef: buildRawRef('Estimate', raw),
    status: s(raw['TxnStatus']),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (raw['ExpirationDate']) result.dueDate = s(raw['ExpirationDate']);
  if (customer) result.customer = customer;
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
