import {
  buildAccountIndex,
  unknownAccountIndex,
} from './quickbooks-job-costing-accounts';
import type { QboNormalizedLine } from '../core/quickbooks-normalizer.service';

/**
 * Whether a line is job cost at all is a question about its account, and the payload does
 * not carry the answer — only the chart of accounts does. Before this existed, every line
 * tagged to a job counted, whatever it posted to.
 *
 * The accounts below are the live chart verbatim: "53600 Subcontractors Expense" and
 * "60400 Bank Services Charges" come back Classification "Expense"; "Services" is
 * Revenue and "Cash on hand" is an Asset. QuickBooks files Expense, Other Expense and
 * Cost of Goods Sold all under Classification "Expense", which is why that one string is
 * the whole test.
 */
const chart = [
  { Id: '188', Name: '53600 Subcontractors Expense', Classification: 'Expense' },
  { Id: '1150040003', Name: '60400 Bank Services Charges', Classification: 'Expense' },
  { Id: '98', Name: 'Supplies & materials - COGS', Classification: 'Expense' },
  { Id: '5', Name: 'Services', Classification: 'Revenue' },
  { Id: '170', Name: 'Cash on hand', Classification: 'Asset' },
  { Id: '157', Name: 'Business Gold Card (1008) - 2', Classification: 'Liability' },
  { Id: '59', Name: 'Opening balance equity', Classification: 'Equity' },
];

const index = buildAccountIndex(chart);

const line = (accountId?: string): QboNormalizedLine => ({
  amount: 100,
  description: '',
  detailType: 'AccountBasedExpenseLineDetail',
  projectRefs: [],
  ...(accountId === undefined ? {} : { account: { value: accountId } }),
});

describe('buildAccountIndex', () => {
  it.each([['188'], ['1150040003'], ['98']])('reads account %s as cost', (id) => {
    expect(index.roleOf(id)).toBe('cost');
    expect(index.countsAsCost(line(id))).toBe(true);
    expect(index.reversesCost(line(id))).toBe(true);
  });

  it.each([['5'], ['170'], ['157'], ['59']])('reads account %s as not cost', (id) => {
    expect(index.roleOf(id)).toBe('not_cost');
    expect(index.countsAsCost(line(id))).toBe(false);
    expect(index.reversesCost(line(id))).toBe(false);
  });

  it('reads an account it has never seen as unknown, not as not-cost', () => {
    expect(index.roleOf('999999')).toBe('unknown');
  });

  it('reads a line with no account at all as unknown', () => {
    expect(index.roleOf('')).toBe('unknown');
    expect(index.roleOf(line().account?.value ?? '')).toBe('unknown');
  });
});

/**
 * The two fail-safe directions, which are opposite on purpose. Both say the same thing —
 * never move money on a guess — but "don't move it" means keeping the line on a cost
 * document and dropping it on a deposit.
 */
describe('an account that cannot be classified', () => {
  it.each([
    ['a deleted account', '999999'],
    ['no account at all', undefined],
  ])('still counts as cost on a cost document (%s)', (_label, id) => {
    expect(index.countsAsCost(line(id))).toBe(true);
  });

  it.each([
    ['a deleted account', '999999'],
    ['no account at all', undefined],
  ])('does not reverse cost on a deposit (%s)', (_label, id) => {
    expect(index.reversesCost(line(id))).toBe(false);
  });

  /**
   * Deposit 4386 in the live file: a $36,000 QuickBooks Payments deposit of a customer
   * invoice, whose line carries a PaymentMethodRef and no AccountRef whatsoever. Reading
   * it as a cost reversal would have taken $36,000 off a job's cost.
   */
  it('does not treat a QuickBooks Payments deposit line as a cost reversal', () => {
    const deposit4386: QboNormalizedLine = {
      amount: -36000,
      description: 'Paid via QuickBooks Payments: Payment ID 185723',
      detailType: 'DepositLineDetail',
      projectRefs: [],
    };

    expect(index.reversesCost(deposit4386)).toBe(false);
  });
});

/**
 * When QuickBooks will not hand over the chart at all, job cost has to keep working, and
 * it has to keep working the way it did before the chart existed: cost documents keep
 * every line, deposits reverse nothing. Anything else would silently restate every job
 * on an outage.
 */
describe('unknownAccountIndex', () => {
  it.each([['188'], ['5'], ['170'], ['']])('answers unknown for %s', (id) => {
    expect(unknownAccountIndex.roleOf(id)).toBe('unknown');
  });

  it('keeps every cost line', () => {
    expect(unknownAccountIndex.countsAsCost(line('5'))).toBe(true);
    expect(unknownAccountIndex.countsAsCost(line('170'))).toBe(true);
  });

  it('reverses no cost from any deposit', () => {
    expect(unknownAccountIndex.reversesCost(line('188'))).toBe(false);
  });
});
