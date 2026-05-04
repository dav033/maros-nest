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
  o,
  s,
} from '../quickbooks-normalizer.utils';

export function normalizeBillPayment(
  raw: Record<string, unknown>,
  attachments: Record<string, unknown>[] = [],
): QboCashOutTransaction {
  const lineItems = normalizeLines(a(raw['Line']));
  const customer = extractRef(raw['CustomerRef']);
  const vendor = extractRef(raw['VendorRef']);
  const checkPay = o(raw['CheckPayment']);
  const ccPay = o(raw['CreditCardPayment']);
  const account = extractRef(checkPay['BankAccountRef']) ?? extractRef(ccPay['CCAccountRef']);
  const projectRefs = collectProjectRefs(customer, lineItems);
  const billableStatus = deriveBillableStatus(lineItems);
  const result: QboCashOutTransaction = {
    source: 'quickbooks',
    direction: 'cash_out',
    entityType: 'BillPayment',
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
    rawRef: buildRawRef('BillPayment', raw),
    status: s(raw['PayType']),
    warnings: buildProjectWarnings(projectRefs),
  };
  if (customer) result.customer = customer;
  if (vendor) result.vendor = vendor;
  if (account) result.account = account;
  if (billableStatus) result.billableStatus = billableStatus;
  return result;
}
