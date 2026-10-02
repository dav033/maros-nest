import { LeadStatus } from '../../../common/enums/lead-status.enum';
import {
  ClientLeadRow,
  aggregateClientScorecard,
  closeRate,
} from './client-scorecard.util';

const lead = (over: Partial<ClientLeadRow> = {}): ClientLeadRow => ({
  contactId: 1,
  contactName: 'Geoff Bruno',
  companyId: null,
  companyName: null,
  status: null,
  estimate: 0,
  startDate: '2026-01-10',
  ...over,
});

describe('closeRate', () => {
  it('is null, not 0, when nothing has been decided', () => {
    expect(closeRate(0, 0)).toBeNull();
  });

  it('is 1 when everything decided was won', () => {
    expect(closeRate(3, 0)).toBe(1);
  });

  it('is 0 when everything decided was lost', () => {
    expect(closeRate(0, 4)).toBe(0);
  });

  it('rounds to four decimals', () => {
    expect(closeRate(6, 1)).toBe(0.8571);
    expect(closeRate(1, 2)).toBe(0.3333);
  });

  it('ignores open leads, which is the whole point of the denominator', () => {
    // 6 won / 1 lost reads the same whether or not three proposals are still out.
    expect(closeRate(6, 1)).toBe(closeRate(6, 1));
    expect(closeRate(1, 1)).toBe(0.5);
  });
});

describe('aggregateClientScorecard', () => {
  it('returns nothing for no leads', () => {
    expect(aggregateClientScorecard([])).toEqual([]);
  });

  it('counts won, lost and open, with NULL status counted as open', () => {
    const row = aggregateClientScorecard([
      lead({ status: LeadStatus.WON }),
      lead({ status: LeadStatus.LOST }),
      lead({ status: LeadStatus.NEW_LEAD }),
      lead({ status: null }),
    ])[0];

    expect(row).toMatchObject({
      leadCount: 4,
      wonCount: 1,
      lostCount: 1,
      openCount: 2,
      decidedCount: 2,
      closeRate: 0.5,
    });
  });

  it('reports a null close rate for a client with pipeline but no outcome', () => {
    const row = aggregateClientScorecard([
      lead({ status: LeadStatus.PROPOSAL_SENT }),
      lead({ status: null }),
    ])[0];

    expect(row.closeRate).toBeNull();
    expect(row.decidedCount).toBe(0);
    expect(row.openCount).toBe(2);
  });

  it('sums estimates in total and in won, treating a null estimate as zero', () => {
    const row = aggregateClientScorecard([
      lead({ status: LeadStatus.WON, estimate: 1000.5 }),
      lead({ status: LeadStatus.WON, estimate: null }),
      lead({ status: LeadStatus.LOST, estimate: 250.25 }),
      lead({ status: null, estimate: 10.1 }),
    ])[0];

    expect(row.estimatedValueTotal).toBe(1260.85);
    expect(row.estimatedValueWon).toBe(1000.5);
  });

  it('keeps the newest start date and survives leads with none', () => {
    const row = aggregateClientScorecard([
      lead({ startDate: '2024-02-01' }),
      lead({ startDate: null }),
      lead({ startDate: '2025-11-30' }),
    ])[0];

    expect(row.lastLeadDate).toBe('2025-11-30');
  });

  it('leaves lastLeadDate null when no lead carries a date', () => {
    expect(aggregateClientScorecard([lead({ startDate: null })])[0].lastLeadDate).toBeNull();
  });

  it('groups by contact and orders by lead count, then won value, then id', () => {
    const rows = aggregateClientScorecard([
      lead({ contactId: 2, contactName: 'One Shot', status: LeadStatus.WON, estimate: 90_000 }),
      lead({ contactId: 3, contactName: 'Sebastian', status: null }),
      lead({ contactId: 3, contactName: 'Sebastian', status: null }),
      lead({ contactId: 4, contactName: 'Geoff', status: LeadStatus.WON, estimate: 500 }),
      lead({ contactId: 4, contactName: 'Geoff', status: LeadStatus.WON, estimate: 500 }),
    ]);

    // Two leads beat one even when the single lead is worth more: the view is about
    // recurring relationships, and the repeat client with zero wins has to be visible.
    expect(rows.map((row) => row.contactId)).toEqual([4, 3, 2]);
    expect(rows[1].closeRate).toBeNull();
  });

  it('carries the company of the contact without grouping by it', () => {
    const rows = aggregateClientScorecard([
      lead({ contactId: 1, companyId: 7, companyName: 'Acme' }),
      lead({ contactId: 2, contactName: 'Other', companyId: 7, companyName: 'Acme' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.companyId === 7 && row.companyName === 'Acme')).toBe(true);
  });
});
