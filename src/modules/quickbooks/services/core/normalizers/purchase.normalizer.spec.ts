import { normalizePurchase } from './purchase.normalizer';

const CUSTOMER = { value: '472', name: '032P-0825, ITB Divine Savior Worship' };

const purchase = (over: Record<string, unknown> = {}) => ({
  Id: '4354',
  TxnDate: '2026-08-28',
  TotalAmt: 202.23,
  PaymentType: 'CreditCard',
  EntityRef: { value: '7', name: 'Home Depot' },
  AccountRef: { value: '35', name: 'Visa' },
  Line: [
    {
      Id: '1',
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: 202.23,
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: '50400', name: 'Construction Materials Costs' },
        CustomerRef: CUSTOMER,
      },
    },
  ],
  ...over,
});

describe('normalizePurchase', () => {
  it('reads an ordinary purchase as a positive cost', () => {
    const result = normalizePurchase(purchase());

    expect(result.totalAmount).toBe(202.23);
    expect(result.lineItems[0].amount).toBe(202.23);
    expect(result.direction).toBe('cash_out');
  });

  /**
   * The bug this file exists for. `Credit: true` marks money coming back — a credit-card
   * refund or a returned order. It was ignored, so a refund was added as cost: the job was
   * overstated by twice the refund, once for not subtracting it and once for adding it.
   *
   * Found against live data: $6,199.87 of refunds on one job inflated its reported cost by
   * $12,399.74, which was exactly the gap against QuickBooks' own Profit and Loss.
   */
  it('subtracts a refund instead of adding it', () => {
    const result = normalizePurchase(purchase({ Credit: true }));

    expect(result.totalAmount).toBe(-202.23);
  });

  /**
   * Negating only the header would leave the lines positive, and the allocation engine sums
   * the *lines* that belong to a project — so the refund would still be charged to the job.
   */
  it('negates the lines too, not just the header', () => {
    const result = normalizePurchase(purchase({ Credit: true }));

    expect(result.lineItems[0].amount).toBe(-202.23);
  });

  it('negates every line of a multi-line refund', () => {
    const result = normalizePurchase(
      purchase({
        Credit: true,
        TotalAmt: 300,
        Line: [
          {
            Id: '1',
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 200,
            AccountBasedExpenseLineDetail: { CustomerRef: CUSTOMER },
          },
          {
            Id: '2',
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 100,
            AccountBasedExpenseLineDetail: { CustomerRef: CUSTOMER },
          },
        ],
      }),
    );

    expect(result.totalAmount).toBe(-300);
    expect(result.lineItems.map((l) => l.amount)).toEqual([-200, -100]);
  });

  /**
   * Only the boolean `true` counts. QuickBooks omits the field on ordinary purchases, and
   * treating a missing or falsy value as a refund would flip the sign of every cost in the
   * file — the opposite and much worse failure.
   */
  it.each([
    ['absent', {}],
    ['false', { Credit: false }],
    ['the string "false"', { Credit: 'false' }],
    ['null', { Credit: null }],
  ])('treats Credit %s as an ordinary purchase', (_label, over) => {
    expect(normalizePurchase(purchase(over)).totalAmount).toBe(202.23);
  });

  /**
   * Deliberately still cash_out. Flipping it to 'credit' would hide the refund from
   * anything selecting cash-out transactions, and a refund that is never subtracted is the
   * bug being fixed.
   */
  it('keeps a refund in the cash-out direction so it cannot be filtered away', () => {
    expect(normalizePurchase(purchase({ Credit: true })).direction).toBe('cash_out');
  });

  it('leaves the project reference on a refund, so it lands on the right job', () => {
    const result = normalizePurchase(purchase({ Credit: true }));

    expect(result.projectRefs.map((r) => r.value)).toContain('472');
  });

  it('keeps the vendor and the payment type of a refund', () => {
    const result = normalizePurchase(purchase({ Credit: true }));

    expect(result.vendor?.name).toBe('Home Depot');
    expect(result.status).toBe('CreditCard');
  });

  it('handles a refund with no lines without producing NaN', () => {
    const result = normalizePurchase(purchase({ Credit: true, Line: [] }));

    expect(result.totalAmount).toBe(-202.23);
    expect(result.lineItems).toEqual([]);
  });

  /** A zero-amount refund must stay 0, not -0, which serialises as "-0" in JSON. */
  it('does not turn a zero amount into negative zero', () => {
    const result = normalizePurchase(purchase({ Credit: true, TotalAmt: 0, Line: [] }));

    expect(Object.is(result.totalAmount, -0)).toBe(false);
    expect(result.totalAmount).toBe(0);
  });
});
