import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import {
  computeDaysOutstanding,
  computeOutstanding,
  computeProjectAging,
  isCollectionSettled,
  resolveAgingBucket,
  sealEndDate,
  sumBucketTotals,
  summarizeByBucket,
  toAmount,
  type ProjectAging,
} from './project-billing.util';

/** Fixed clock: an aging report that depends on the day the suite runs proves nothing. */
const AS_OF = new Date(2026, 9, 1);

/** 'YYYY-MM-DD' exactly n calendar days before AS_OF. */
function daysAgo(n: number): string {
  return new Date(Date.UTC(2026, 9, 1) - n * 86_400_000).toISOString().slice(0, 10);
}

describe('daysAgo helper', () => {
  // Anchors the helper itself — a broken one would make every boundary below pass.
  it('counts back calendar days', () => {
    expect(daysAgo(0)).toBe('2026-10-01');
    expect(daysAgo(30)).toBe('2026-09-01');
    expect(daysAgo(91)).toBe('2026-07-02');
  });
});

describe('toAmount', () => {
  it('parses the strings the pg driver returns for NUMERIC', () => {
    expect(toAmount('1234.56')).toBe(1234.56);
    expect(toAmount('0.00')).toBe(0);
  });

  it('keeps zero distinct from unknown', () => {
    expect(toAmount(0)).toBe(0);
    expect(toAmount(null)).toBeNull();
    expect(toAmount(undefined)).toBeNull();
  });

  it('collapses unparseable values to null rather than 0', () => {
    expect(toAmount('')).toBeNull();
    expect(toAmount('n/a')).toBeNull();
    expect(toAmount(Number.NaN)).toBeNull();
    expect(toAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('computeDaysOutstanding', () => {
  it('counts from billed_at when it exists', () => {
    expect(computeDaysOutstanding({ billedAt: daysAgo(45), endDate: null }, AS_OF)).toBe(45);
  });

  it('falls back to end_date when the work was finished but never invoiced', () => {
    expect(
      computeDaysOutstanding({ billedAt: null, endDate: new Date(2026, 8, 1) }, AS_OF),
    ).toBe(30);
  });

  it('prefers billed_at over end_date when both exist', () => {
    expect(
      computeDaysOutstanding({ billedAt: daysAgo(10), endDate: new Date(2025, 0, 1) }, AS_OF),
    ).toBe(10);
  });

  it('returns null — not 0 — when neither date exists', () => {
    expect(computeDaysOutstanding({ billedAt: null, endDate: null }, AS_OF)).toBeNull();
    expect(computeDaysOutstanding({}, AS_OF)).toBeNull();
    expect(computeDaysOutstanding({ billedAt: '', endDate: '' }, AS_OF)).toBeNull();
  });

  it('ignores the time of day on a timestamp end_date', () => {
    const lateAtNight = new Date(2026, 8, 1, 23, 59, 59);
    const earlyMorning = new Date(2026, 8, 1, 0, 0, 1);
    expect(computeDaysOutstanding({ endDate: lateAtNight }, AS_OF)).toBe(30);
    expect(computeDaysOutstanding({ endDate: earlyMorning }, AS_OF)).toBe(30);
  });

  it('clamps a future date to 0 instead of going negative', () => {
    expect(computeDaysOutstanding({ billedAt: '2027-01-01' }, AS_OF)).toBe(0);
  });

  it('returns null for an unparseable date', () => {
    expect(computeDaysOutstanding({ billedAt: 'not-a-date' }, AS_OF)).toBeNull();
    expect(computeDaysOutstanding({ endDate: new Date('nonsense') }, AS_OF)).toBeNull();
  });

  it('reads a full timestamp string as its calendar day', () => {
    expect(computeDaysOutstanding({ endDate: '2026-09-01T22:30:00.000Z' }, AS_OF)).toBe(30);
  });
});

describe('resolveAgingBucket', () => {
  it('puts day 0 and day 30 in current, day 31 in the next bucket', () => {
    expect(resolveAgingBucket(0)).toBe('current');
    expect(resolveAgingBucket(30)).toBe('current');
    expect(resolveAgingBucket(31)).toBe('31_60');
  });

  it('closes 31_60 at day 60 and opens 61_90 at day 61', () => {
    expect(resolveAgingBucket(60)).toBe('31_60');
    expect(resolveAgingBucket(61)).toBe('61_90');
  });

  it('closes 61_90 at day 90 and opens over_90 at day 91', () => {
    expect(resolveAgingBucket(90)).toBe('61_90');
    expect(resolveAgingBucket(91)).toBe('over_90');
    expect(resolveAgingBucket(4000)).toBe('over_90');
  });

  it('maps an unknown age to its own bucket, never to current', () => {
    expect(resolveAgingBucket(null)).toBe('unknown');
  });
});

describe('computeOutstanding', () => {
  it('treats a null collected_amount as nothing collected', () => {
    expect(computeOutstanding(1000, null)).toEqual({ outstandingAmount: 1000, overpaid: false });
  });

  it('gives the same balance for collected 0 as for collected null', () => {
    expect(computeOutstanding(1000, 0).outstandingAmount).toBe(
      computeOutstanding(1000, null).outstandingAmount,
    );
  });

  it('subtracts a partial collection', () => {
    expect(computeOutstanding(1000, 400)).toEqual({ outstandingAmount: 600, overpaid: false });
  });

  it('settles at exactly zero when the invoice is fully collected', () => {
    expect(computeOutstanding(1000, 1000)).toEqual({ outstandingAmount: 0, overpaid: false });
  });

  it('clamps an overpayment to 0 and flags it, so a client credit cannot net against real debt', () => {
    expect(computeOutstanding(1000, 1200)).toEqual({ outstandingAmount: 0, overpaid: true });
  });

  it('returns a null balance when nothing was billed, even if money came in', () => {
    expect(computeOutstanding(null, null)).toEqual({ outstandingAmount: null, overpaid: false });
    expect(computeOutstanding(null, 500)).toEqual({ outstandingAmount: null, overpaid: false });
  });

  it('owes nothing on a zero invoice', () => {
    expect(computeOutstanding(0, null)).toEqual({ outstandingAmount: 0, overpaid: false });
  });

  it('does not leave float dust in the balance', () => {
    expect(computeOutstanding(1000.1, 999.2).outstandingAmount).toBe(0.9);
  });
});

describe('computeProjectAging', () => {
  it('reads amounts and dates straight off a driver-shaped row', () => {
    expect(
      computeProjectAging(
        { billedAmount: '5000.00', collectedAmount: '1500.00', billedAt: daysAgo(61) },
        AS_OF,
      ),
    ).toEqual({
      billedAmount: 5000,
      collectedAmount: 1500,
      outstandingAmount: 3500,
      overpaid: false,
      daysOutstanding: 61,
      agingBucket: '61_90',
    });
  });

  it('keeps an undated, unbilled completed project fully unknown', () => {
    expect(computeProjectAging({}, AS_OF)).toEqual({
      billedAmount: null,
      collectedAmount: null,
      outstandingAmount: null,
      overpaid: false,
      daysOutstanding: null,
      agingBucket: 'unknown',
    });
  });
});

describe('isCollectionSettled', () => {
  const aging = (partial: Partial<ProjectAging>): ProjectAging => ({
    billedAmount: 1000,
    collectedAmount: 0,
    outstandingAmount: 1000,
    overpaid: false,
    daysOutstanding: 10,
    agingBucket: 'current',
    ...partial,
  });

  it('settles a fully collected invoice', () => {
    expect(isCollectionSettled(aging({ collectedAmount: 1000, outstandingAmount: 0 }))).toBe(true);
  });

  it('settles an overpaid invoice: a credit is not a receivable', () => {
    expect(
      isCollectionSettled(aging({ collectedAmount: 1200, outstandingAmount: 0, overpaid: true })),
    ).toBe(true);
  });

  it('never settles an unbilled project, because nothing proves it was collected', () => {
    expect(
      isCollectionSettled(aging({ billedAmount: null, outstandingAmount: null })),
    ).toBe(false);
  });

  it('does not settle a partial collection', () => {
    expect(isCollectionSettled(aging({ collectedAmount: 400, outstandingAmount: 600 }))).toBe(false);
  });
});

describe('summarizeByBucket', () => {
  const row = (partial: Partial<ProjectAging>): ProjectAging => ({
    billedAmount: 1000,
    collectedAmount: null,
    outstandingAmount: 1000,
    overpaid: false,
    daysOutstanding: 10,
    agingBucket: 'current',
    ...partial,
  });

  it('reports every bucket even when empty, so the report has no missing rows', () => {
    const totals = summarizeByBucket([]);
    expect(Object.keys(totals)).toEqual(['current', '31_60', '61_90', 'over_90', 'unknown']);
    expect(totals.over_90).toEqual({
      projectCount: 0,
      outstandingAmount: 0,
      unbilledProjectCount: 0,
    });
  });

  it('sums balances inside each bucket and counts the rows', () => {
    const totals = summarizeByBucket([
      row({ outstandingAmount: 1000.5 }),
      row({ outstandingAmount: 250.25 }),
      row({ agingBucket: 'over_90', outstandingAmount: 7800, daysOutstanding: 400 }),
    ]);

    expect(totals.current).toEqual({
      projectCount: 2,
      outstandingAmount: 1250.75,
      unbilledProjectCount: 0,
    });
    expect(totals.over_90.outstandingAmount).toBe(7800);
  });

  it('counts an unbilled project without letting its null balance read as 0 owed', () => {
    const totals = summarizeByBucket([
      row({ billedAmount: null, outstandingAmount: null, agingBucket: 'unknown', daysOutstanding: null }),
      row({ billedAmount: null, outstandingAmount: null, agingBucket: '31_60', daysOutstanding: 45 }),
    ]);

    expect(totals.unknown).toEqual({
      projectCount: 1,
      outstandingAmount: 0,
      unbilledProjectCount: 1,
    });
    expect(totals['31_60'].unbilledProjectCount).toBe(1);
  });

  it('adds the buckets up to the grand total', () => {
    const totals = summarizeByBucket([
      row({ outstandingAmount: 100 }),
      row({ agingBucket: '61_90', outstandingAmount: 200, daysOutstanding: 70 }),
      row({ agingBucket: 'unknown', outstandingAmount: null, billedAmount: null, daysOutstanding: null }),
    ]);

    expect(sumBucketTotals(totals)).toEqual({
      projectCount: 3,
      outstandingAmount: 300,
      unbilledProjectCount: 1,
    });
  });
});

describe('sealEndDate', () => {
  const now = new Date(2026, 9, 1, 14, 30);

  it('stamps the transition date on a project that reaches COMPLETED with no end_date', () => {
    expect(
      sealEndDate(ProjectProgressStatus.IN_PROGRESS, ProjectProgressStatus.COMPLETED, null, now),
    ).toBe(now);
  });

  it('stamps a project created straight into COMPLETED', () => {
    expect(sealEndDate(undefined, ProjectProgressStatus.COMPLETED, undefined, now)).toBe(now);
  });

  it('never overwrites a date someone entered by hand', () => {
    const realCompletion = new Date(2025, 2, 14);
    expect(
      sealEndDate(
        ProjectProgressStatus.IN_PROGRESS,
        ProjectProgressStatus.COMPLETED,
        realCompletion,
        now,
      ),
    ).toBeNull();
  });

  it('does nothing on an unrelated edit to an already-COMPLETED project', () => {
    // Otherwise appending a note would reset a balance aging since last winter to day 0.
    expect(
      sealEndDate(ProjectProgressStatus.COMPLETED, ProjectProgressStatus.COMPLETED, null, now),
    ).toBeNull();
  });

  it('does nothing for any other status', () => {
    for (const status of [
      ProjectProgressStatus.IN_PROGRESS,
      ProjectProgressStatus.NOT_EXECUTED,
      ProjectProgressStatus.LOST,
      ProjectProgressStatus.POSTPONED,
      ProjectProgressStatus.PERMITS,
    ]) {
      expect(sealEndDate(ProjectProgressStatus.IN_PROGRESS, status, null, now)).toBeNull();
    }
    expect(sealEndDate(ProjectProgressStatus.COMPLETED, undefined, null, now)).toBeNull();
  });
});
