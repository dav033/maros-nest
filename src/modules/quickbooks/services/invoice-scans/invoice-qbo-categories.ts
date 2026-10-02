import type { ExtractedInvoiceData } from '../../entities/invoice-scan.entity';

export interface QboOption {
  id: string;
  name: string;
}

/**
 * The QuickBooks AccountType values that can hold a cost.
 *
 * Filtering on the type is the whole point: it is what QuickBooks itself says an account
 * is for, so an income account can never be offered as a place to book an expense. The
 * previous implementation selected AccountType and then ignored it, matching on the account
 * *name* instead — which let "Materials Sales" through and kept "Permits" out.
 */
export const EXPENSE_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  'Expense',
  'Other Expense',
  'Cost of Goods Sold',
]);

/**
 * The item types worth offering alongside accounts.
 *
 * `Service` alone was the old filter, which is why QuickBooks **Categories** — an item type
 * literally called Category — never reached the reviewer, and neither did the inventory and
 * non-inventory items a materials purchase actually maps to.
 */
export const SUGGESTABLE_ITEM_TYPES: ReadonlySet<string> = new Set([
  'Service',
  'NonInventory',
  'Inventory',
  'Category',
  'Group',
  'Bundle',
]);

/**
 * Words that hint an account is the right home for a given kind of document. Used only to
 * *order* the list, never to filter it — see rankExpenseAccounts.
 */
const CLASSIFICATION_HINTS: Record<string, readonly string[]> = {
  materials_expense: ['material', 'supply', 'supplies', 'lumber', 'cogs', 'cost of goods'],
  subcontractor_expense: ['subcontract', 'sub-contractor', 'labor', 'labour', 'contractor'],
  customer_service: ['income', 'revenue', 'sales', 'service'],
};

/**
 * Names that should sink, not disappear.
 *
 * "office" because Office Supplies was being offered for construction materials. And the
 * retired-account markers because this company's chart really contains
 * "Equipment rental - COGS (DO NOT USE)" — an account the bookkeeper has labelled as
 * off-limits, which the hint words still matched straight into the top five. It stays in the
 * list, since only the bookkeeper knows whether a historical entry belongs there.
 */
const DEPRIORITISED = ['office', 'bank', 'payroll tax', 'penalt', 'do not use', 'deprecated'];

function normalise(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim();
}

export function isExpenseAccount(record: Record<string, unknown>): boolean {
  return EXPENSE_ACCOUNT_TYPES.has(String(record.AccountType ?? ''));
}

/**
 * Every expense account the company has, best guess first.
 *
 * Ordering, not filtering. The reviewer is choosing the category a cost is booked under, and
 * a suggestion list that can only ever contain eight accounts is not a shortlist — it is a
 * hidden restriction on the chart of accounts. The old version matched account names against
 * six hardcoded English words, so of this company's accounts it could surface exactly eight,
 * every one of them a variant of materials/supplies/subcontractor, while Permits, Labor,
 * Equipment Rental, Fuel, Insurance and Cost of Goods Sold were unreachable — and "Office
 * Supplies" was offered for construction materials because it contains "supplies".
 *
 * So hints now only lift the likely ones to the top, line-item text included, and everything
 * else follows alphabetically. A wrong guess costs the reviewer a scroll; a missing account
 * costs them the ability to categorise the document at all.
 */
export function rankExpenseAccounts(
  records: unknown[],
  classification: ExtractedInvoiceData['classification'],
  lineItems: ExtractedInvoiceData['lineItems'] = [],
): QboOption[] {
  const hints = CLASSIFICATION_HINTS[classification] ?? [];
  const lineText = lineItems.map((line) => normalise(line.description)).join(' ');

  const scored = records
    .filter(
      (value): value is Record<string, unknown> =>
        value !== null && typeof value === 'object',
    )
    .filter(isExpenseAccount)
    .map((record) => ({ id: String(record.Id ?? ''), name: String(record.Name ?? '') }))
    .filter((account) => account.id && account.name)
    .map((account) => {
      const name = normalise(account.name);
      let score = 0;
      if (hints.some((hint) => name.includes(hint))) score += 2;
      // The document's own words beat the classification: a line reading "dumpster" should
      // lift a Dumpster account above the generic materials one.
      if (lineText && name.split(/\s+/).some((word) => word.length > 3 && lineText.includes(word))) {
        score += 1;
      }
      if (DEPRIORITISED.some((term) => name.includes(term))) score -= 1;
      return { ...account, score };
    });

  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}
