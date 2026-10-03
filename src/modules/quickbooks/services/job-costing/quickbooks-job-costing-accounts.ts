import { QboNormalizedLine } from '../core/quickbooks-normalizer.service';

/**
 * Where a QuickBooks account sits on the Profit and Loss. `unknown` is a real answer, not
 * a placeholder: the account was deleted, the chart could not be loaded, or the line names
 * no account at all. Code that acts on it has to say what it does when it does not know.
 */
export type QboAccountRole = 'cost' | 'not_cost' | 'unknown';

export type QboAccountIndex = {
  roleOf(accountId: string): QboAccountRole;
  /**
   * Whether a cost document's line (Purchase, Bill, VendorCredit, …) is job cost.
   *
   * Only a positive "this is not a cost account" excludes it. Not knowing keeps the line,
   * because the alternative — dropping anything unclassified — would make real cost
   * vanish from a job the moment QuickBooks was slow or an account was renamed. The
   * reconciliation against the Profit and Loss is what catches an account wrongly kept;
   * nothing catches cost silently removed.
   */
  countsAsCost(line: QboNormalizedLine): boolean;
  /**
   * Whether a Deposit line reverses cost rather than being revenue.
   *
   * The safe direction inverts here, because keeping the line *subtracts* money: only a
   * positive "this is a cost account" counts. Not knowing leaves the figure alone, which
   * is the same instinct as above — never move money on a guess. In the live file this is
   * what keeps deposit 4386, a $36,000 QuickBooks Payments deposit whose line carries no
   * AccountRef, from being read as a $36,000 cost reversal.
   */
  reversesCost(line: QboNormalizedLine): boolean;
};

/**
 * QuickBooks groups Expense, Other Expense and Cost of Goods Sold under the single
 * Classification "Expense"; Asset, Liability, Equity and Revenue are the rest. Verified
 * against the live chart of 236 accounts: "53600 Subcontractors Expense" and
 * "60400 Bank Services Charges" both come back Classification "Expense", while
 * "Services", "Cash on hand" and "Business Gold Card" do not.
 */
const COST_CLASSIFICATION = 'Expense';

export function buildAccountIndex(
  accounts: Array<Record<string, unknown>>,
): QboAccountIndex {
  const roles = new Map<string, QboAccountRole>();
  for (const account of accounts) {
    const id = account['Id'] == null ? '' : String(account['Id']);
    if (!id) continue;
    roles.set(
      id,
      String(account['Classification'] ?? '') === COST_CLASSIFICATION
        ? 'cost'
        : 'not_cost',
    );
  }

  const roleOf = (accountId: string): QboAccountRole =>
    (accountId && roles.get(accountId)) || 'unknown';

  return {
    roleOf,
    countsAsCost: (line) => roleOf(lineAccountId(line)) !== 'not_cost',
    reversesCost: (line) => roleOf(lineAccountId(line)) === 'cost',
  };
}

/**
 * The index every caller gets when the chart of accounts could not be read. It answers
 * `unknown` to everything, which by the rules above leaves every figure exactly where it
 * was before the chart existed: cost documents keep all their lines, deposits reverse
 * nothing.
 */
export const unknownAccountIndex: QboAccountIndex = buildAccountIndex([]);

function lineAccountId(line: QboNormalizedLine): string {
  return line.account?.value ?? line.category?.value ?? '';
}
