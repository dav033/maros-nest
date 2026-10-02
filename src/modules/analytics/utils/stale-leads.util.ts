import { LeadStatus } from '../../../common/enums/lead-status.enum';
import {
  StaleAgeBucket,
  StaleLeadsSummaryDto,
} from '../dto/stale-leads.dto';

/**
 * The statuses that have not resolved into a yes or a no.
 *
 * WON and LOST are the only decided outcomes in LeadStatus, so this is "everything
 * else" — written out by hand rather than derived, so that a status added to the enum
 * later has to be classified deliberately instead of being counted as rot by default.
 *
 * NULL is absent because it is not a value: the oldest rot in production has no status at
 * all and only `IS NULL` matches it. Callers have to handle it separately.
 */
export const UNDECIDED_LEAD_STATUSES: readonly LeadStatus[] = [
  LeadStatus.NEW_LEAD,
  LeadStatus.CONTACTED,
  LeadStatus.ESTIMATING_PREPARING_PROPOSAL,
  LeadStatus.PROPOSAL_SENT,
  LeadStatus.FOLLOW_UP,
];

/**
 * 60 days, not 30.
 *
 * Age here is time since the lead started, not time since anything last happened (see
 * AnalyticsStaleLeadsService for why), so a 30-day cutoff flags every lead that opened
 * over a month ago including the ones being actively worked. At 60 days the list is
 * short enough that someone will actually read it and decide, which is the only outcome
 * that matters. Tighten it once a real activity timestamp exists.
 */
export const DEFAULT_STALE_DAYS = 60;

/** Fixed, in ascending order, so the chart's x axis never reorders itself. */
export const STALE_AGE_BUCKETS: readonly StaleAgeBucket[] = [
  '0-29',
  '30-59',
  '60-89',
  '90-179',
  '180-364',
  '365+',
];

/**
 * Whole days between two calendar dates, floored.
 *
 * Both ends are reduced to UTC midnight first: leads.start_date is a DATE column with no
 * time in it, and without that the age of every lead would shift by a day depending on
 * the server's offset and whether DST moved since the lead opened.
 */
export function ageInDays(startDate: Date | string, now: Date): number {
  const start = toUtcMidnight(startDate);
  const today = toUtcMidnight(now);
  if (start === null || today === null) return 0;
  return Math.floor((today - start) / 86_400_000);
}

export function staleAgeBucket(ageDays: number): StaleAgeBucket {
  if (ageDays < 30) return '0-29';
  if (ageDays < 60) return '30-59';
  if (ageDays < 90) return '60-89';
  if (ageDays < 180) return '90-179';
  if (ageDays < 365) return '180-364';
  return '365+';
}

/**
 * Counts and money per age bucket, every bucket present even when empty.
 *
 * Empty buckets are returned as zeros rather than omitted because the whole point of the
 * view is that the number nobody looks at is zero-ish; a missing key renders as a gap and
 * reads as "no data" instead of "none that old".
 */
export function summarizeStaleLeads(
  leads: Array<{ ageDays: number; estimate: number }>,
  undated: { count: number; estimate: number } = { count: 0, estimate: 0 },
): StaleLeadsSummaryDto {
  const counts = new Map<StaleAgeBucket, { count: number; estimate: number }>();
  for (const bucket of STALE_AGE_BUCKETS) {
    counts.set(bucket, { count: 0, estimate: 0 });
  }

  let totalEstimate = 0;
  for (const lead of leads) {
    const bucket = counts.get(staleAgeBucket(lead.ageDays))!;
    bucket.count += 1;
    bucket.estimate += lead.estimate;
    totalEstimate += lead.estimate;
  }

  return {
    totalCount: leads.length,
    totalEstimate: roundMoney(totalEstimate),
    buckets: STALE_AGE_BUCKETS.map((bucket) => ({
      bucket,
      count: counts.get(bucket)!.count,
      estimate: roundMoney(counts.get(bucket)!.estimate),
    })),
    undatedCount: undated.count,
    undatedEstimate: roundMoney(undated.estimate),
  };
}

/** Summing floats in JS, so the cents have to be put back where they belong. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A Date is read in local time and a string by its first ten characters, because the two
 * reach us from different places: pg hands back a Date built at *local* midnight for a
 * DATE column, while a hand-written YYYY-MM-DD carries no zone at all. Reading the Date
 * as UTC would move it a day for half the world's offsets.
 */
function toUtcMidnight(value: Date | string): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
