import {
  isExpenseAccount,
  rankExpenseAccounts,
  SUGGESTABLE_ITEM_TYPES,
} from './invoice-qbo-categories';

const account = (Id: string, Name: string, AccountType = 'Expense') => ({
  Id,
  Name,
  AccountType,
  Active: true,
});

const line = (description: string) => ({
  description,
  quantity: null,
  unitPrice: null,
  amount: null,
});

/**
 * This company's chart of accounts, as the old keyword filter saw it versus what it actually
 * contains. Of these, name-matching on ['material','supply','supplies','lumber','subcontract']
 * could reach only the first five — Permits, Labor, Equipment Rental, Dumpster and COGS were
 * unreachable, and Office Supplies was offered for construction materials.
 */
const chart = [
  account('1', 'Construction Materials Costs'),
  account('2', 'Supplies & materials - COGS', 'Cost of Goods Sold'),
  account('3', 'Office Supplies'),
  account('4', 'Subcontractors Expense'),
  account('5', 'Supplies'),
  account('6', 'Permits'),
  account('7', 'Labor'),
  account('8', 'Equipment Rental'),
  account('9', 'Dumpster'),
  account('10', 'Cost of Goods Sold', 'Cost of Goods Sold'),
  account('11', 'Materials Sales', 'Income'),
  account('12', 'Checking', 'Bank'),
];

describe('isExpenseAccount', () => {
  it('accepts the three types that can hold a cost', () => {
    expect(isExpenseAccount(account('1', 'x', 'Expense'))).toBe(true);
    expect(isExpenseAccount(account('1', 'x', 'Other Expense'))).toBe(true);
    expect(isExpenseAccount(account('1', 'x', 'Cost of Goods Sold'))).toBe(true);
  });

  /** The case name-matching got wrong: an income account whose name contains "Materials". */
  it('rejects income, asset and bank accounts whatever they are called', () => {
    expect(isExpenseAccount(account('1', 'Materials Sales', 'Income'))).toBe(false);
    expect(isExpenseAccount(account('1', 'Checking', 'Bank'))).toBe(false);
    expect(isExpenseAccount(account('1', 'Anything', 'Accounts Receivable'))).toBe(false);
  });

  it('rejects a record with no type rather than assuming it is an expense', () => {
    expect(isExpenseAccount({ Id: '1', Name: 'Mystery' })).toBe(false);
  });
});

describe('rankExpenseAccounts', () => {
  it('offers every expense account, not a hardcoded handful', () => {
    const result = rankExpenseAccounts(chart, 'materials_expense');

    // 12 accounts in, 2 of them non-expense: 10 out. The old filter returned 5.
    expect(result).toHaveLength(10);
    const names = result.map((a) => a.name);
    expect(names).toContain('Permits');
    expect(names).toContain('Labor');
    expect(names).toContain('Equipment Rental');
    expect(names).toContain('Dumpster');
    expect(names).toContain('Cost of Goods Sold');
  });

  it('leaves out what QuickBooks says is not an expense', () => {
    const names = rankExpenseAccounts(chart, 'materials_expense').map((a) => a.name);

    expect(names).not.toContain('Materials Sales');
    expect(names).not.toContain('Checking');
  });

  it('puts the likely category first for a materials document', () => {
    const [first] = rankExpenseAccounts(chart, 'materials_expense');

    expect(['Construction Materials Costs', 'Supplies & materials - COGS']).toContain(first.name);
  });

  it('puts the subcontractor account first for a subcontractor document', () => {
    const [first] = rankExpenseAccounts(chart, 'subcontractor_expense');

    expect(['Subcontractors Expense', 'Labor']).toContain(first.name);
  });

  /** "Office Supplies" matched 'supplies' and outranked real cost accounts. */
  it('stops ranking office supplies above construction costs', () => {
    const names = rankExpenseAccounts(chart, 'materials_expense').map((a) => a.name);

    expect(names.indexOf('Construction Materials Costs')).toBeLessThan(
      names.indexOf('Office Supplies'),
    );
  });

  it('lets the document own words beat the classification', () => {
    const names = rankExpenseAccounts(chart, 'materials_expense', [
      line('30 yard dumpster rental for the week'),
    ]).map((a) => a.name);

    // Dumpster has no classification hint at all, so only the line text can lift it.
    expect(names.indexOf('Dumpster')).toBeLessThan(names.indexOf('Permits'));
  });

  /**
   * Found by running a real document through the pipeline: this company's chart contains
   * "Equipment rental - COGS (DO NOT USE)", and the hint words lifted it into the top five.
   */
  it('sinks an account the bookkeeper marked as not to be used', () => {
    const names = rankExpenseAccounts(
      [
        account('1', 'Equipment rental - COGS (DO NOT USE)', 'Cost of Goods Sold'),
        account('2', 'Construction Materials Costs'),
      ],
      'materials_expense',
    ).map((a) => a.name);

    expect(names[0]).toBe('Construction Materials Costs');
    // Still offered: only the bookkeeper knows if a historical entry belongs there.
    expect(names).toContain('Equipment rental - COGS (DO NOT USE)');
  });

  it('still returns the whole list when nothing matches at all', () => {
    const result = rankExpenseAccounts(chart, 'unknown');

    expect(result).toHaveLength(10);
  });

  it('orders alphabetically within the same score, so the list is stable', () => {
    const unhinted = rankExpenseAccounts(
      [account('1', 'Zinc'), account('2', 'Alpha'), account('3', 'Middle')],
      'unknown',
    );

    expect(unhinted.map((a) => a.name)).toEqual(['Alpha', 'Middle', 'Zinc']);
  });

  it('survives malformed records without losing the valid ones', () => {
    const result = rankExpenseAccounts(
      [null, 'nonsense', { Id: '', Name: 'No id' }, { Id: '5', Name: '' }, account('6', 'Permits')],
      'unknown',
    );

    expect(result).toEqual([{ id: '6', name: 'Permits' }]);
  });

  it('returns nothing for an empty chart rather than throwing', () => {
    expect(rankExpenseAccounts([], 'materials_expense')).toEqual([]);
  });
});

describe('SUGGESTABLE_ITEM_TYPES', () => {
  /**
   * The regression: the item query and the ranking both accepted only `Service`, so the
   * QuickBooks item type actually named Category never reached the reviewer.
   */
  it('includes Category and the inventory types, not just Service', () => {
    expect(SUGGESTABLE_ITEM_TYPES.has('Category')).toBe(true);
    expect(SUGGESTABLE_ITEM_TYPES.has('NonInventory')).toBe(true);
    expect(SUGGESTABLE_ITEM_TYPES.has('Inventory')).toBe(true);
    expect(SUGGESTABLE_ITEM_TYPES.has('Service')).toBe(true);
  });
});
