import {
  hasDirectionClassificationConflict,
  resolveQboLookupSides,
} from './invoice-qbo-lookup-sides';

const both = { revenue: true, expense: true };
const revenueOnly = { revenue: true, expense: false };
const expenseOnly = { revenue: false, expense: true };

describe('resolveQboLookupSides', () => {
  describe('when the two signals agree', () => {
    it('offers the revenue side for an invoice we issued', () => {
      expect(resolveQboLookupSides('outgoing', 'customer_service')).toEqual(revenueOnly);
    });

    it('offers the expense side for a supplier bill', () => {
      expect(resolveQboLookupSides('incoming', 'materials_expense')).toEqual(expenseOnly);
      expect(resolveQboLookupSides('incoming', 'subcontractor_expense')).toEqual(expenseOnly);
    });
  });

  describe('when the classification says nothing', () => {
    it('falls back to the direction alone', () => {
      expect(resolveQboLookupSides('outgoing', 'other')).toEqual(revenueOnly);
      expect(resolveQboLookupSides('outgoing', 'unknown')).toEqual(revenueOnly);
      expect(resolveQboLookupSides('incoming', 'other')).toEqual(expenseOnly);
      expect(resolveQboLookupSides('incoming', 'unknown')).toEqual(expenseOnly);
    });
  });

  it('offers everything when the direction could not be read', () => {
    expect(resolveQboLookupSides('unknown', 'subcontractor_expense')).toEqual(both);
    expect(resolveQboLookupSides('unknown', 'customer_service')).toEqual(both);
    expect(resolveQboLookupSides('unknown', 'unknown')).toEqual(both);
  });

  /**
   * The regression this module exists for. Five of these were sitting in production: proofs
   * of payment to subcontractors, labelled `outgoing` because the cash left, so their
   * counterparty was searched against Customers and matched at 37-38% while the Vendor list
   * — which contains the subcontractor — was never queried.
   */
  describe('when the signals contradict each other', () => {
    it('offers both sides for a payment to a subcontractor labelled outgoing', () => {
      expect(resolveQboLookupSides('outgoing', 'subcontractor_expense')).toEqual(both);
    });

    it('offers both sides for a materials expense labelled outgoing', () => {
      expect(resolveQboLookupSides('outgoing', 'materials_expense')).toEqual(both);
    });

    /**
     * The mirror case, also real: a document labelled `incoming` yet classified
     * `customer_service` that matched a vendor at 100%. It is why a contradiction widens
     * the lookup instead of letting the classification override the direction — the
     * direction was the right signal there, and the classification was the wrong one.
     */
    it('offers both sides for a customer service document labelled incoming', () => {
      expect(resolveQboLookupSides('incoming', 'customer_service')).toEqual(both);
    });

    it('never narrows away a side the direction alone would have offered', () => {
      const directions = ['outgoing', 'incoming', 'unknown'] as const;
      const classifications = [
        'customer_service',
        'materials_expense',
        'subcontractor_expense',
        'other',
        'unknown',
      ] as const;

      for (const direction of directions) {
        const fromDirectionOnly = resolveQboLookupSides(direction, 'unknown');
        for (const classification of classifications) {
          const actual = resolveQboLookupSides(direction, classification);
          if (fromDirectionOnly.revenue) expect(actual.revenue).toBe(true);
          if (fromDirectionOnly.expense) expect(actual.expense).toBe(true);
        }
      }
    });

    it('always leaves at least one side to look up', () => {
      const directions = ['outgoing', 'incoming', 'unknown'] as const;
      const classifications = [
        'customer_service',
        'materials_expense',
        'subcontractor_expense',
        'other',
        'unknown',
      ] as const;

      for (const direction of directions) {
        for (const classification of classifications) {
          const sides = resolveQboLookupSides(direction, classification);
          expect(sides.revenue || sides.expense).toBe(true);
        }
      }
    });
  });
});

describe('hasDirectionClassificationConflict', () => {
  it('flags a document whose direction and classification disagree', () => {
    expect(hasDirectionClassificationConflict('outgoing', 'subcontractor_expense')).toBe(true);
    expect(hasDirectionClassificationConflict('outgoing', 'materials_expense')).toBe(true);
    expect(hasDirectionClassificationConflict('incoming', 'customer_service')).toBe(true);
  });

  it('stays quiet when they agree', () => {
    expect(hasDirectionClassificationConflict('outgoing', 'customer_service')).toBe(false);
    expect(hasDirectionClassificationConflict('incoming', 'materials_expense')).toBe(false);
  });

  /**
   * An unreadable signal is a gap, not a contradiction. Reporting it as a conflict would
   * put a warning on most of the queue and train the reviewer to ignore the flag.
   */
  it('stays quiet when either signal is simply missing', () => {
    expect(hasDirectionClassificationConflict('outgoing', 'unknown')).toBe(false);
    expect(hasDirectionClassificationConflict('outgoing', 'other')).toBe(false);
    expect(hasDirectionClassificationConflict('unknown', 'subcontractor_expense')).toBe(false);
    expect(hasDirectionClassificationConflict('unknown', 'unknown')).toBe(false);
  });
});
