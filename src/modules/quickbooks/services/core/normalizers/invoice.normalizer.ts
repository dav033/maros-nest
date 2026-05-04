import { QboCashInTransaction } from '../quickbooks-normalizer.types';
import {
  a,
  buildProjectWarnings,
  buildRawRef,
  collectProjectRefs,
  deriveBillableStatus,
  deriveInvoiceStatus,
  extractDescription,
  extractLinkedTxn,
  extractMemo,
  extractRef,
  n,
  normalizeAttachments,
  normalizeLines,
  s,
} from '../quickbooks-normalizer.utils';

export function normalizeInvoice(
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
    entityType: 'Invoice',
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
    rawRef: buildRawRef('Invoice', raw),
    status: deriveInvoiceStatus(raw),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (raw['DueDate']) result.dueDate = s(raw['DueDate']);
  if (customer) result.customer = customer;
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
