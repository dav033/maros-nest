import { normalizeDeposit } from './deposit.normalizer';

/**
 * Deposit 4387, verbatim from the live file. It cancels a 36,000 charge against
 * "60400 Bank Services Charges" on job 061-0226, which is why QuickBooks' Profit and Loss
 * shows 1,076.40 on that account and the app — never querying Deposit at all — showed
 * 36,000. The reversal is 34,923.60 of the 63,723.60 that job was overstated by.
 */
const deposit4387 = {
  Id: '4387',
  TxnDate: '2026-08-13',
  TotalAmt: 34923.6,
  DepositToAccountRef: { value: '154', name: 'BUS COMPLETE CHK (5052) - 1' },
  PrivateNote: 'Quickbooks transaction return',
  Line: [
    {
      Id: '1',
      LineNum: 1,
      Description: 'Quickbooks transaction return',
      Amount: 34923.6,
      DetailType: 'DepositLineDetail',
      DepositLineDetail: {
        Entity: {
          value: '485',
          name: '061-0226,1721 NW 48 ST Miami, FL 33142 Residential Addition',
          type: 'CUSTOMER',
        },
        AccountRef: { value: '1150040003', name: '60400 Bank Services Charges' },
      },
    },
  ],
};

describe('normalizeDeposit', () => {
  it('negates the amount, because the money is coming back', () => {
    const deposit = normalizeDeposit(deposit4387);

    expect(deposit.totalAmount).toBe(-34923.6);
    expect(deposit.lineItems[0].amount).toBe(-34923.6);
  });

  /**
   * Negating only the header would leave the lines positive, and the allocation engine
   * charges the *lines* that belong to a project — so the reversal would be added as cost
   * instead of subtracted, the same shape of bug as the Purchase refunds.
   */
  it('negates every line of a multi-line deposit, not just the header', () => {
    const deposit = normalizeDeposit({
      ...deposit4387,
      TotalAmt: 1500,
      Line: [
        { Amount: 1000, DetailType: 'DepositLineDetail', DepositLineDetail: {} },
        { Amount: 500, DetailType: 'DepositLineDetail', DepositLineDetail: {} },
      ],
    });

    expect(deposit.totalAmount).toBe(-1500);
    expect(deposit.lineItems.map((l) => l.amount)).toEqual([-1000, -500]);
  });

  /** A zero amount must stay 0, not -0, which serialises as "-0" in JSON. */
  it('does not turn a zero amount into negative zero', () => {
    const deposit = normalizeDeposit({ ...deposit4387, TotalAmt: 0, Line: [] });

    expect(Object.is(deposit.totalAmount, -0)).toBe(false);
    expect(deposit.totalAmount).toBe(0);
  });

  /**
   * Deposit names the other party on the line as `Entity` itself, not through
   * JournalEntry's nested `Entity.EntityRef`, and types it 'CUSTOMER' in upper case. Miss
   * that and the reversal never reaches the job it belongs to.
   */
  it('reads the project from the line entity', () => {
    const deposit = normalizeDeposit(deposit4387);

    expect(deposit.projectRefs.map((r) => r.value)).toContain('485');
    expect(deposit.lineItems[0].customer?.value).toBe('485');
  });

  it('keeps the account the line posts to, which is what decides it is a cost reversal', () => {
    const deposit = normalizeDeposit(deposit4387);

    expect(deposit.lineItems[0].account?.value).toBe('1150040003');
  });

  /**
   * A deposit line whose Entity is a vendor is not a job's cost reversal. Deposit 3215 in
   * the live file is one: 2,307.00 of workers' comp refunded by the insurer.
   */
  it('does not read a vendor entity as a project', () => {
    const deposit = normalizeDeposit({
      ...deposit4387,
      Line: [
        {
          Amount: 2307,
          DetailType: 'DepositLineDetail',
          DepositLineDetail: {
            Entity: { value: '299', name: 'EMPLOYERS INSURANCE AGENCY, INC', type: 'VENDOR' },
            AccountRef: { value: '190', name: "Worker's Compensation Insurance" },
          },
        },
      ],
    });

    expect(deposit.lineItems[0].customer).toBeUndefined();
    expect(deposit.projectRefs).toEqual([]);
  });

  /**
   * Deposit 4386: 36,000 of customer invoice paid through QuickBooks Payments. Its line
   * carries a PaymentMethodRef, a LinkedTxn to the Payment, and no AccountRef at all —
   * so nothing identifies it as cost and nothing ties it to a job.
   */
  it('leaves a QuickBooks Payments deposit without an account or a project', () => {
    const deposit = normalizeDeposit({
      Id: '4386',
      TxnDate: '2026-09-03',
      TotalAmt: 36000,
      Line: [
        {
          Description: 'Paid via QuickBooks Payments: Payment ID 185723',
          Amount: 36000,
          LinkedTxn: [{ TxnId: '3998', TxnType: 'Payment' }],
          DepositLineDetail: { PaymentMethodRef: { value: '6' } },
        },
      ],
    });

    expect(deposit.lineItems[0].account).toBeUndefined();
    expect(deposit.projectRefs).toEqual([]);
    expect(deposit.linkedTxn).toEqual([{ txnId: '3998', txnType: 'Payment' }]);
  });

  it('stays in the cash-out direction so it cannot be filtered away', () => {
    expect(normalizeDeposit(deposit4387).direction).toBe('cash_out');
    expect(normalizeDeposit(deposit4387).entityType).toBe('Deposit');
  });
});
