import {
  BreakdownContext,
  buildBreakdownEngine,
  summarizeEngine,
} from './quickbooks-job-costing-breakdown.aggregation';
import { money } from '../core/qbo-value.utils';
import type { QboJobCostTransaction } from './quickbooks-job-costing.types';

/**
 * The two totals on a job cost report have to agree: the job's `totalJobCost` and the sum
 * of the per-vendor and per-category buckets that are supposed to decompose it. They did
 * not, because the buckets added `committedPo` and the job total did not.
 *
 * Verified against QuickBooks' Profit and Loss for 032P-0825 (customer 472): the report
 * says 190,814.28 in Accrual, which is what the job total reported; the buckets added up
 * to 192,958.97 — the 2,144.69 of open purchase orders on that job. An open PO is a
 * commitment, not a cost incurred; when the bill arrives it is counted through openAp.
 */
const ctx = {
  money,
  firstLineCategory: () => undefined,
  normalizeName: (v: string) => v.toLowerCase(),
} as unknown as BreakdownContext;

const txn = (
  classification: QboJobCostTransaction['classification'],
  allocatedAmount: number,
  vendorName: string,
): QboJobCostTransaction =>
  ({
    classification,
    allocatedAmount,
    vendor: { value: '1', name: vendorName },
    lineItems: [],
  }) as unknown as QboJobCostTransaction;

/** The shape of 032P-0825: paid cash, one open bill and one open purchase order. */
const job032P0825 = [
  txn('cash_out_paid', 190586.43, 'OPIFEX - SINGERGY'),
  txn('open_ap', 227.85, 'OPIFEX - SINGERGY'),
  txn('commitment', 2144.69, 'OPIFEX - SINGERGY'),
];

describe('job cost breakdown', () => {
  it('keeps the buckets adding up to the job total', () => {
    const summary = summarizeEngine(ctx, job032P0825);
    const buckets = buildBreakdownEngine(ctx, job032P0825, 'vendor');

    expect(summary.totalJobCost).toBe(190814.28);
    expect(money(buckets.reduce((sum, b) => sum + b.totalJobCost, 0))).toBe(
      summary.totalJobCost,
    );
  });

  it('leaves the open purchase order out of the bucket total', () => {
    const [bucket] = buildBreakdownEngine(ctx, job032P0825, 'vendor');

    // 192,958.97 before the fix.
    expect(bucket.totalJobCost).toBe(190814.28);
  });

  it('still reports the commitment on its own field', () => {
    const [bucket] = buildBreakdownEngine(ctx, job032P0825, 'vendor');

    expect(bucket.committedPo).toBe(2144.69);
  });

  /**
   * A vendor credit reduces what the job cost, so it has to come off the bucket as it comes
   * off the summary. Getting this sign wrong would make credits *add* to cost.
   */
  it('subtracts a vendor credit from the bucket, as the summary does', () => {
    const transactions = [
      txn('cash_out_paid', 1000, 'Acme'),
      txn('credit', 250, 'Acme'),
    ];

    const [bucket] = buildBreakdownEngine(ctx, transactions, 'vendor');

    expect(bucket.vendorCredits).toBe(250);
    expect(bucket.totalJobCost).toBe(750);
    expect(summarizeEngine(ctx, transactions).totalJobCost).toBe(750);
  });
});
