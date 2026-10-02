import { LeadStatus } from '../../../common/enums/lead-status.enum';
import {
  STALE_AGE_BUCKETS,
  UNDECIDED_LEAD_STATUSES,
  ageInDays,
  staleAgeBucket,
  summarizeStaleLeads,
} from './stale-leads.util';

describe('UNDECIDED_LEAD_STATUSES', () => {
  it('is every status except WON and LOST', () => {
    const decided = [LeadStatus.WON, LeadStatus.LOST];
    const expected = Object.values(LeadStatus).filter((status) => !decided.includes(status));

    expect([...UNDECIDED_LEAD_STATUSES].sort()).toEqual([...expected].sort());
  });
});

describe('ageInDays', () => {
  const now = new Date('2026-10-01T15:30:00Z');

  it('counts whole days and ignores the time of day', () => {
    expect(ageInDays('2026-09-01', now)).toBe(30);
    expect(ageInDays('2026-10-01', now)).toBe(0);
  });

  it('reads a Date in local time, because that is how pg hands back a DATE column', () => {
    // Local midnight on the 21st: nine days back whatever the server's offset is.
    expect(ageInDays(new Date(2026, 8, 22), now)).toBe(9);
  });

  it('is negative for a start date in the future', () => {
    expect(ageInDays('2026-10-05', now)).toBe(-4);
  });

  it('is 0 for something unparseable rather than NaN', () => {
    expect(ageInDays('not a date', now)).toBe(0);
    expect(ageInDays(new Date('nope'), now)).toBe(0);
  });
});

describe('staleAgeBucket', () => {
  it('places each boundary in the higher bucket', () => {
    expect(staleAgeBucket(0)).toBe('0-29');
    expect(staleAgeBucket(29)).toBe('0-29');
    expect(staleAgeBucket(30)).toBe('30-59');
    expect(staleAgeBucket(59)).toBe('30-59');
    expect(staleAgeBucket(60)).toBe('60-89');
    expect(staleAgeBucket(89)).toBe('60-89');
    expect(staleAgeBucket(90)).toBe('90-179');
    expect(staleAgeBucket(179)).toBe('90-179');
    expect(staleAgeBucket(180)).toBe('180-364');
    expect(staleAgeBucket(364)).toBe('180-364');
    expect(staleAgeBucket(365)).toBe('365+');
    expect(staleAgeBucket(900)).toBe('365+');
  });

  it('puts a future-dated lead in the youngest bucket instead of throwing', () => {
    expect(staleAgeBucket(-5)).toBe('0-29');
  });
});

describe('summarizeStaleLeads', () => {
  it('returns zeros and every bucket for an empty list, never NaN', () => {
    const summary = summarizeStaleLeads([]);

    expect(summary.totalCount).toBe(0);
    expect(summary.totalEstimate).toBe(0);
    expect(summary.undatedCount).toBe(0);
    expect(summary.undatedEstimate).toBe(0);
    expect(summary.buckets.map((bucket) => bucket.bucket)).toEqual([...STALE_AGE_BUCKETS]);
    expect(summary.buckets.every((bucket) => bucket.count === 0 && bucket.estimate === 0)).toBe(
      true,
    );
    expect(Object.values(summary).some((value) => Number.isNaN(value))).toBe(false);
  });

  it('adds counts and money into the right bucket', () => {
    const summary = summarizeStaleLeads([
      { ageDays: 61, estimate: 1000 },
      { ageDays: 89, estimate: 500 },
      { ageDays: 520, estimate: 2000.5 },
    ]);

    expect(summary.totalCount).toBe(3);
    expect(summary.totalEstimate).toBe(3500.5);
    expect(summary.buckets.find((b) => b.bucket === '60-89')).toEqual({
      bucket: '60-89',
      count: 2,
      estimate: 1500,
    });
    expect(summary.buckets.find((b) => b.bucket === '365+')).toEqual({
      bucket: '365+',
      count: 1,
      estimate: 2000.5,
    });
    expect(summary.buckets.find((b) => b.bucket === '0-29')).toEqual({
      bucket: '0-29',
      count: 0,
      estimate: 0,
    });
  });

  it('rounds the float noise out of its sums', () => {
    const summary = summarizeStaleLeads([
      { ageDays: 70, estimate: 0.1 },
      { ageDays: 70, estimate: 0.2 },
    ]);

    expect(summary.totalEstimate).toBe(0.3);
    expect(summary.buckets.find((b) => b.bucket === '60-89')!.estimate).toBe(0.3);
  });

  it('keeps undated leads out of the buckets and reports them on their own', () => {
    const summary = summarizeStaleLeads([{ ageDays: 400, estimate: 100 }], {
      count: 2,
      estimate: 50.005,
    });

    expect(summary.totalCount).toBe(1);
    expect(summary.totalEstimate).toBe(100);
    expect(summary.undatedCount).toBe(2);
    expect(summary.undatedEstimate).toBe(50.01);
  });
});
