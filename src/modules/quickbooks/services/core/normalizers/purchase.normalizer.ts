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
  negate,
  normalizeAttachments,
  normalizeLines,
  s,
} from '../quickbooks-normalizer.utils';

/**
 * A Purchase with `Credit: true` is money coming back — a credit-card refund, a returned
 * order. QuickBooks reports it as a negative inside Cost of Goods Sold, so netting it into
 * the same bucket (rather than into a separate credits total) is what makes job cost here
 * agree with QuickBooks' own Profit and Loss.
 *
 * Until this existed the flag was ignored and refunds were added as cost, which overstated
 * a job by *twice* the refunds: once for not subtracting, once for adding. On the job this
 * was found on, $6,199.87 of refunds inflated the reported cost by $12,399.74.
 */
function isRefund(raw: Record<string, unknown>): boolean {
  return raw['Credit'] === true;
}

export function normalizePurchase(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboCashOutTransaction {
  const refund = isRefund(raw);
  // Negated at the line level too, not only on the header: the allocation engine sums the
  // lines that belong to a project, so a refund whose header was negative while its lines
  // stayed positive would still be charged as a cost to whichever job it was tagged to.
  const lineItems = normalizeLines(a(raw['Line'])).map((line) =>
    refund ? { ...line, amount: negate(line.amount) } : line,
  );
  const customer = extractRef(raw['CustomerRef']);
  const vendor = extractRef(raw['EntityRef']);
  const account = extractRef(raw['AccountRef']);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboCashOutTransaction = {
    source: 'quickbooks',
    // Still 'cash_out' when it is a refund, with the amount negative. The alternative —
    // flipping it to 'credit' — would hide it from anything that selects cash-out
    // transactions, and a refund that is never subtracted is the bug this fixes.
    direction: 'cash_out',
    entityType: 'Purchase',
    entityId: s(raw['Id']),
    docNumber: s(raw['DocNumber']),
    txnDate: s(raw['TxnDate']),
    totalAmount: refund ? negate(n(raw['TotalAmt'])) : n(raw['TotalAmt']),
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
