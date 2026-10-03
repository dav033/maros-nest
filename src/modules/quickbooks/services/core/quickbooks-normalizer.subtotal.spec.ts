import { QuickbooksNormalizerService } from './quickbooks-normalizer.service';

/**
 * QuickBooks closes a sales form with a running-total row that repeats the whole document
 * in its Amount. The normalizer is meant to drop it, but it compared DetailType against
 * `'SubTotalLine'` — a value QuickBooks never sends; the real one is `SubTotalLineDetail`.
 * So the guard never fired and every form summed to twice itself.
 *
 * Measured against the live file: 97 of 100 invoices and 106 of 106 estimates had a line
 * total of exactly 2x their own TotalAmt. Invoice 1190 below is one of them, verbatim:
 * TotalAmt 500 against lines summing 1000.
 *
 * It doubled a basis rather than a reported total, so no job cost figure moved — but the
 * same guard is what keeps the job-costing allocation engine's raw-row cursor in step with
 * the normalized lines, and there a drift charges a cost line to the job twice.
 */
describe('QuickbooksNormalizerService — subtotal rows', () => {
  const normalizer = new QuickbooksNormalizerService();

  const invoice1190 = {
    Id: '4499',
    DocNumber: '1190',
    TxnDate: '2026-09-15',
    TotalAmt: 500,
    CustomerRef: { value: '582', name: '091-0626 Project Managment' },
    Line: [
      {
        Id: '1',
        LineNum: 1,
        Description: 'Project management services for construction and related projects.',
        Amount: 500,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '162', name: 'Project Management Services:Project Management' },
          UnitPrice: 500,
          Qty: 1,
        },
      },
      { Amount: 500, DetailType: 'SubTotalLineDetail', SubTotalLineDetail: {} },
    ],
  };

  it('drops the subtotal row so the lines add up to the document, not to twice it', () => {
    const invoice = normalizer.normalizeInvoice(invoice1190);

    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems.reduce((sum, l) => sum + l.amount, 0)).toBe(500);
    expect(invoice.totalAmount).toBe(500);
  });

  it('drops it on an estimate too, which carries the same row', () => {
    const estimate = normalizer.normalizeEstimate({
      ...invoice1190,
      Id: '4498',
      DocNumber: '1189',
    });

    expect(estimate.lineItems).toHaveLength(1);
    expect(estimate.lineItems[0].amount).toBe(500);
  });

  /**
   * The inverse mistake is the dangerous one: dropping a real cost line because its
   * DetailType merely looks like a subtotal would silently remove money from a job.
   */
  it.each([
    ['SalesItemLineDetail'],
    ['AccountBasedExpenseLineDetail'],
    ['ItemBasedExpenseLineDetail'],
    ['JournalEntryLineDetail'],
    ['DiscountLineDetail'],
    ['SubTotalLine'],
  ])('keeps a %s line', (detailType) => {
    const purchase = normalizer.normalizePurchase({
      Id: '1',
      TotalAmt: 70,
      Line: [{ Amount: 70, DetailType: detailType }],
    });

    expect(purchase.lineItems).toHaveLength(1);
    expect(purchase.lineItems[0].amount).toBe(70);
  });
});
