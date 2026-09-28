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
  // QBO no expone TotalAmt en JournalEntry (responde 400 "Property TotalAmt not
  // found for Entity JournalEntry"), asi que el importe de cabecera no se puede
  // saber. Eso es `null`, no cero: con cero el asiento se dibujaria como si
  // moviera $0 y nadie notaria que el dato falta.
  const rawTotal = raw['TotalAmt'];
  const totalAmount = rawTotal === undefined || rawTotal === null ? null : n(rawTotal);
  const result: QboNormalizedTransaction = {
    source: 'quickbooks',
    direction: 'adjustment',
    entityType: 'JournalEntry',
    entityId: s(raw['Id']),
    docNumber: s(raw['DocNumber']),
    txnDate: s(raw['TxnDate']),
    totalAmount,
    projectRefs,
    lineItems,
    linkedTxn: extractLinkedTxn(raw),
    memo: extractMemo(raw),
    description: extractDescription(raw),
    attachments: normalizeAttachments(attachments),
    rawRef: buildRawRef('JournalEntry', raw),
    warnings: [
      ...buildProjectWarnings(projectRefs),
      ...(totalAmount === null
        ? [
            {
              code: 'TOTAL_AMOUNT_UNAVAILABLE',
              message:
                'QuickBooks does not expose TotalAmt for JournalEntry; the header amount is unknown, not zero.',
            },
          ]
        : []),
    ],
  };
  if (customer) result.customer = customer;
  if (account) {
    result.account = account;
    result.category = account;
  }
  return result;
}
