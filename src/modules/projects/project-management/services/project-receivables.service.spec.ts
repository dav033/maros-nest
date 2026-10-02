import type { ReceivableCandidateRow } from '../repositories/projects.repository';
import { ProjectReceivablesService } from './project-receivables.service';

const AS_OF = new Date(2026, 9, 1);

function daysAgo(n: number): string {
  return new Date(Date.UTC(2026, 9, 1) - n * 86_400_000).toISOString().slice(0, 10);
}

function candidate(partial: Partial<ReceivableCandidateRow>): ReceivableCandidateRow {
  return {
    id: 1,
    leadNumber: '001-0726',
    name: 'Kitchen remodel',
    billedAmount: null,
    collectedAmount: null,
    billedAt: null,
    endDate: null,
    ...partial,
  };
}

function serviceWith(rows: ReceivableCandidateRow[]): ProjectReceivablesService {
  return new ProjectReceivablesService({
    findCompletedCollectionCandidates: jest.fn().mockResolvedValue(rows),
  } as never);
}

describe('ProjectReceivablesService.getReceivables', () => {
  it('returns the row shape the collection screen reads', async () => {
    const report = await serviceWith([
      candidate({
        id: '42',
        leadNumber: '017-0825',
        name: 'Roof replacement',
        billedAmount: '12000.00',
        collectedAmount: '4000.00',
        billedAt: daysAgo(45),
        endDate: new Date(2026, 6, 15),
      }),
    ]).getReceivables(AS_OF);

    expect(report.projects).toEqual([
      {
        id: 42,
        leadNumber: '017-0825',
        name: 'Roof replacement',
        billedAmount: 12000,
        collectedAmount: 4000,
        outstandingAmount: 8000,
        billedAt: daysAgo(45),
        endDate: '2026-07-15',
        daysOutstanding: 45,
        agingBucket: '31_60',
      },
    ]);
    expect(report.asOf).toBe('2026-10-01');
  });

  it('drops projects whose collection is closed, including overpaid ones', async () => {
    const report = await serviceWith([
      candidate({ id: 1, billedAmount: '1000.00', collectedAmount: '1000.00', billedAt: daysAgo(5) }),
      candidate({ id: 2, billedAmount: '1000.00', collectedAmount: '1500.00', billedAt: daysAgo(5) }),
      candidate({ id: 3, billedAmount: '0.00', collectedAmount: null, billedAt: daysAgo(5) }),
      candidate({ id: 4, billedAmount: '1000.00', collectedAmount: '999.99', billedAt: daysAgo(5) }),
    ]).getReceivables(AS_OF);

    expect(report.projects.map((project) => project.id)).toEqual([4]);
    expect(report.projects[0].outstandingAmount).toBe(0.01);
  });

  it('keeps completed-but-never-billed work on the list with a null balance', async () => {
    const report = await serviceWith([
      candidate({ id: 7, billedAmount: null, collectedAmount: null, endDate: new Date(2026, 8, 1) }),
    ]).getReceivables(AS_OF);

    expect(report.projects[0]).toMatchObject({
      outstandingAmount: null,
      daysOutstanding: 30,
      agingBucket: 'current',
      billedAt: null,
      endDate: '2026-09-01',
    });
    expect(report.totals.current).toEqual({
      projectCount: 1,
      outstandingAmount: 0,
      unbilledProjectCount: 1,
    });
  });

  it('marks a project with no dates at all as unknown rather than current', async () => {
    const report = await serviceWith([
      candidate({ id: 9, billedAmount: '5000.00' }),
    ]).getReceivables(AS_OF);

    expect(report.projects[0]).toMatchObject({
      daysOutstanding: null,
      agingBucket: 'unknown',
      outstandingAmount: 5000,
    });
    expect(report.totals.unknown.outstandingAmount).toBe(5000);
  });

  it('sorts oldest debt first and pushes the undated rows to the end', async () => {
    const report = await serviceWith([
      candidate({ id: 1, billedAmount: '100.00', billedAt: daysAgo(10) }),
      candidate({ id: 2, billedAmount: '100.00' }),
      candidate({ id: 3, billedAmount: '100.00', billedAt: daysAgo(200) }),
      candidate({ id: 4, billedAmount: '100.00', billedAt: daysAgo(61) }),
    ]).getReceivables(AS_OF);

    expect(report.projects.map((project) => project.id)).toEqual([3, 4, 1, 2]);
  });

  it('totals each bucket and adds them into the grand total', async () => {
    const report = await serviceWith([
      candidate({ id: 1, billedAmount: '1000.00', billedAt: daysAgo(30) }),
      candidate({ id: 2, billedAmount: '2000.00', collectedAmount: '500.00', billedAt: daysAgo(31) }),
      candidate({ id: 3, billedAmount: '3000.00', billedAt: daysAgo(91) }),
      candidate({ id: 4, billedAmount: null, endDate: new Date(2026, 5, 1) }),
    ]).getReceivables(AS_OF);

    expect(report.totals).toEqual({
      current: { projectCount: 1, outstandingAmount: 1000, unbilledProjectCount: 0 },
      '31_60': { projectCount: 1, outstandingAmount: 1500, unbilledProjectCount: 0 },
      '61_90': { projectCount: 0, outstandingAmount: 0, unbilledProjectCount: 0 },
      over_90: { projectCount: 2, outstandingAmount: 3000, unbilledProjectCount: 1 },
      unknown: { projectCount: 0, outstandingAmount: 0, unbilledProjectCount: 0 },
    });
    expect(report.grandTotal).toEqual({
      projectCount: 4,
      outstandingAmount: 5500,
      unbilledProjectCount: 1,
    });
  });

  it('answers with empty totals when nothing is outstanding', async () => {
    const report = await serviceWith([]).getReceivables(AS_OF);

    expect(report.projects).toEqual([]);
    expect(report.grandTotal).toEqual({
      projectCount: 0,
      outstandingAmount: 0,
      unbilledProjectCount: 0,
    });
  });
});
