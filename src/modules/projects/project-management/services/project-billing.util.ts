import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';

/**
 * Pure arithmetic behind GET /projects/receivables and the end_date seal.
 *
 * Kept free of Nest and TypeORM because every interesting case here is a boundary
 * (day 30 vs 31, NULL vs 0, collected > billed) and those are only cheap to pin down
 * when they can be called with plain values.
 */

export type AgingBucket = 'current' | '31_60' | '61_90' | 'over_90' | 'unknown';

/** Every bucket, in the order a report reads top to bottom. */
export const AGING_BUCKETS: readonly AgingBucket[] = [
  'current',
  '31_60',
  '61_90',
  'over_90',
  'unknown',
];

/** What the aging math needs off a project row, in the shape the driver returns it. */
export interface ProjectBillingSource {
  billedAmount?: string | number | null;
  collectedAmount?: string | number | null;
  billedAt?: string | Date | null;
  endDate?: string | Date | null;
}

export interface ProjectAging {
  billedAmount: number | null;
  collectedAmount: number | null;
  /** NULL when billedAmount is unknown: the debt exists but its size does not yet. */
  outstandingAmount: number | null;
  /** Collected more than billed. A credit owed to the client, not a receivable. */
  overpaid: boolean;
  daysOutstanding: number | null;
  agingBucket: AgingBucket;
}

export interface AgingBucketTotal {
  projectCount: number;
  outstandingAmount: number;
  /**
   * Projects counted in this bucket whose billed_amount is NULL. Their debt is real but
   * absent from outstandingAmount, so the sum is a floor, not a total — without this
   * count a reader would read the floor as the whole answer.
   */
  unbilledProjectCount: number;
}

/**
 * NUMERIC arrives as a string from the pg driver, and '' / NaN arrive from hand-edited
 * rows. Anything that is not a finite number collapses to null rather than 0, because a
 * zero here would be read as "nothing owed".
 */
export function toAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calendar day of a value, as UTC midnight, so a difference of dates is a difference of
 * days. DATE columns come back as 'YYYY-MM-DD' and timestamps as a local-time Date; both
 * are read for their calendar fields only, so a row stamped at 23:00 is not a day older
 * than the same row stamped at 01:00.
 */
function toUtcMidnight(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : toUtcMidnight(parsed);
  }

  if (Number.isNaN(value.getTime())) return null;
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

const MS_PER_DAY = 86_400_000;

/**
 * Days the balance has been outstanding, counted from the invoice date and falling back
 * to the completion date — billing starts the clock, but work finished and never invoiced
 * is still aging, and that is the majority of the backlog.
 *
 * Returns null when neither date exists. Not 0: "we have no idea how old this is" must
 * not render next to the invoices that genuinely went out today.
 *
 * A date in the future (fat-fingered year, invoice dated ahead) clamps to 0 instead of
 * going negative, which would otherwise sort ahead of real current debt.
 */
export function computeDaysOutstanding(
  source: Pick<ProjectBillingSource, 'billedAt' | 'endDate'>,
  asOf: Date,
): number | null {
  const from = toUtcMidnight(source.billedAt) ?? toUtcMidnight(source.endDate);
  if (from === null) return null;

  const to = toUtcMidnight(asOf);
  if (to === null) return null;

  return Math.max(0, Math.floor((to - from) / MS_PER_DAY));
}

/** Buckets are inclusive at both ends: 0-30, 31-60, 61-90, then everything older. */
export function resolveAgingBucket(daysOutstanding: number | null): AgingBucket {
  if (daysOutstanding === null) return 'unknown';
  if (daysOutstanding <= 30) return 'current';
  if (daysOutstanding <= 60) return '31_60';
  if (daysOutstanding <= 90) return '61_90';
  return 'over_90';
}

/**
 * What is still owed.
 *
 * Overpayment (collected > billed) clamps to 0 and is flagged instead of going negative:
 * a client credit is a liability, and letting it net against another project's debt in a
 * bucket total would silently shrink the receivable the report exists to show.
 *
 * A null collected_amount counts as nothing collected, which is the same number as 0 but
 * a different fact — see `ProjectAging.collectedAmount`, which keeps the distinction.
 */
export function computeOutstanding(
  billedAmount: number | null,
  collectedAmount: number | null,
): { outstandingAmount: number | null; overpaid: boolean } {
  if (billedAmount === null) {
    // Nothing to subtract from. Any collection against an unknown invoice is a data
    // problem, not an overpayment, so it is not flagged as one.
    return { outstandingAmount: null, overpaid: false };
  }

  const collected = collectedAmount ?? 0;
  const difference = round2(billedAmount - collected);

  return { outstandingAmount: Math.max(0, difference), overpaid: difference < 0 };
}

/** NUMERIC(12,2) in, NUMERIC(12,2) out: subtraction must not invent float dust. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeProjectAging(source: ProjectBillingSource, asOf: Date): ProjectAging {
  const billedAmount = toAmount(source.billedAmount);
  const collectedAmount = toAmount(source.collectedAmount);
  const { outstandingAmount, overpaid } = computeOutstanding(billedAmount, collectedAmount);
  const daysOutstanding = computeDaysOutstanding(source, asOf);

  return {
    billedAmount,
    collectedAmount,
    outstandingAmount,
    overpaid,
    daysOutstanding,
    agingBucket: resolveAgingBucket(daysOutstanding),
  };
}

/**
 * Whether the project is done owing us money, which is the only reason to drop it from
 * the report. An unbilled project is never settled: we cannot prove a collection against
 * an invoice that was never recorded.
 */
export function isCollectionSettled(aging: ProjectAging): boolean {
  return aging.outstandingAmount !== null && aging.outstandingAmount === 0;
}

export function summarizeByBucket(rows: readonly ProjectAging[]): Record<AgingBucket, AgingBucketTotal> {
  const totals = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [bucket, { projectCount: 0, outstandingAmount: 0, unbilledProjectCount: 0 }]),
  ) as Record<AgingBucket, AgingBucketTotal>;

  for (const row of rows) {
    const total = totals[row.agingBucket];
    total.projectCount += 1;
    total.outstandingAmount = round2(total.outstandingAmount + (row.outstandingAmount ?? 0));
    if (row.billedAmount === null) total.unbilledProjectCount += 1;
  }

  return totals;
}

export function sumBucketTotals(
  totals: Record<AgingBucket, AgingBucketTotal>,
): AgingBucketTotal {
  return AGING_BUCKETS.reduce<AgingBucketTotal>(
    (accumulator, bucket) => ({
      projectCount: accumulator.projectCount + totals[bucket].projectCount,
      outstandingAmount: round2(accumulator.outstandingAmount + totals[bucket].outstandingAmount),
      unbilledProjectCount: accumulator.unbilledProjectCount + totals[bucket].unbilledProjectCount,
    }),
    { projectCount: 0, outstandingAmount: 0, unbilledProjectCount: 0 },
  );
}

/**
 * The date to stamp on a project whose status just landed on COMPLETED, or null when the
 * row must be left alone.
 *
 * Only ever fills a hole. Whoever typed a date in by hand knew when the crew actually
 * finished; the moment somebody clicked a dropdown months later does not, so overwriting
 * would move the aging clock on exactly the projects somebody bothered to fix.
 *
 * It also has to be a *transition*, not merely "is COMPLETED now". Twenty-one projects are
 * already COMPLETED with an empty end_date, and stamping today's date on one of them
 * because someone appended a note would reset a balance that has been aging for months to
 * day zero — the report would report its own write as good news.
 */
export function sealEndDate(
  previousStatus: ProjectProgressStatus | null | undefined,
  nextStatus: ProjectProgressStatus | null | undefined,
  currentEndDate: Date | null | undefined,
  now: Date,
): Date | null {
  if (nextStatus !== ProjectProgressStatus.COMPLETED) return null;
  if (previousStatus === ProjectProgressStatus.COMPLETED) return null;
  if (currentEndDate) return null;
  return now;
}
