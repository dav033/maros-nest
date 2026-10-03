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
 * A Deposit is money arriving in a bank account, and QuickBooks records it as a positive
 * amount against whatever account the line names. Most deposits are revenue — a customer
 * paying an invoice — but a line posted against an *expense* account is the reversal of a
 * cost: a returned payment, a refunded fee, a rebate. QuickBooks' Profit and Loss nets it
 * as a negative inside that expense account, so the amounts are negated here and netted
 * into cash out, exactly as a Purchase flagged `Credit` is.
 *
 * Which lines are cost reversals is decided downstream, by the chart of accounts (see
 * QboAccountIndex.reversesCost) — not here, because the account's classification is not
 * in the payload. That split matters: negating a customer payment would subtract real
 * revenue from a job's cost. Deposit 4386 in the live file is exactly that hazard — a
 * $36,000 QuickBooks Payments deposit whose line carries no AccountRef at all.
 *
 * Found by reconciling job 061-0226 against the Profit and Loss: a deposit of 34,923.60
 * against "Bank Services Charges" cancels a 36,000 charge on the same account, leaving
 * 1,076.40. Never querying Deposit meant the app reported the 36,000 gross.
 */
export function normalizeDeposit(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboCashOutTransaction {
  const lineItems = normalizeLines(a(raw['Line'])).map((line) => ({
    ...line,
    amount: negate(line.amount),
  }));
  const customer = extractRef(raw['CustomerRef']);
  const account = extractRef(raw['DepositToAccountRef']);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboCashOutTransaction = {
    source: 'quickbooks',
    direction: 'cash_out',
    entityType: 'Deposit',
    entityId: s(raw['Id']),
    docNumber: s(raw['DocNumber']),
    txnDate: s(raw['TxnDate']),
    totalAmount: negate(n(raw['TotalAmt'])),
    projectRefs,
    lineItems,
    linkedTxn: extractLinkedTxn(raw),
    memo: extractMemo(raw),
    description: extractDescription(raw),
    attachments: normalizeAttachments(attachments),
    rawRef: buildRawRef('Deposit', raw),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (customer) result.customer = customer;
  if (account) {
    result.account = account;
    result.category = account;
  }
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
