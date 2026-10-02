import { Injectable } from '@nestjs/common';
import {
  ProjectsRepository,
  type ReceivableCandidateRow,
} from '../repositories/projects.repository';
import {
  computeProjectAging,
  isCollectionSettled,
  summarizeByBucket,
  sumBucketTotals,
  type AgingBucket,
  type AgingBucketTotal,
  type ProjectAging,
} from './project-billing.util';

export interface ProjectReceivable {
  id: number;
  leadNumber: string | null;
  name: string | null;
  billedAmount: number | null;
  collectedAmount: number | null;
  outstandingAmount: number | null;
  billedAt: string | null;
  endDate: string | null;
  daysOutstanding: number | null;
  agingBucket: AgingBucket;
}

export interface ProjectReceivablesReport {
  asOf: string;
  projects: ProjectReceivable[];
  totals: Record<AgingBucket, AgingBucketTotal>;
  grandTotal: AgingBucketTotal;
}

@Injectable()
export class ProjectReceivablesService {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  /**
   * The collection list: finished work still owed to us, aged.
   *
   * `asOf` is a parameter so the whole report is reproducible — the alternative is a
   * figure that silently differs between two people opening it either side of midnight.
   */
  async getReceivables(asOf: Date = new Date()): Promise<ProjectReceivablesReport> {
    const candidates = await this.projectsRepository.findCompletedCollectionCandidates();

    const aged = candidates
      .map((row) => ({ row, aging: computeProjectAging(row, asOf) }))
      // Overpaid and exactly-paid projects leave here: nothing is owed, so nothing is
      // receivable. The SQL prefilter cannot make this call because it does not know that
      // a NULL collected_amount means zero collected.
      .filter(({ aging }) => !isCollectionSettled(aging));

    // Oldest debt first, with the undated rows last. They are not "newest" — their age is
    // unknown — but burying them under answers that exist is the only order that reads
    // correctly as a worklist.
    aged.sort((a, b) => (b.aging.daysOutstanding ?? -1) - (a.aging.daysOutstanding ?? -1));

    const totals = summarizeByBucket(aged.map(({ aging }) => aging));

    return {
      asOf: formatDateOnly(asOf),
      projects: aged.map(({ row, aging }) => this.toReceivable(row, aging)),
      totals,
      grandTotal: sumBucketTotals(totals),
    };
  }

  private toReceivable(row: ReceivableCandidateRow, aging: ProjectAging): ProjectReceivable {
    return {
      id: Number(row.id),
      leadNumber: row.leadNumber ?? null,
      name: row.name ?? null,
      billedAmount: aging.billedAmount,
      collectedAmount: aging.collectedAmount,
      outstandingAmount: aging.outstandingAmount,
      // Both dates go out as plain YYYY-MM-DD: they are the two possible starts of the
      // aging clock, and a timezone-bearing timestamp would let a client render end_date
      // as the day before the one the days count was computed from.
      billedAt: toDateOnly(row.billedAt),
      endDate: toDateOnly(row.endDate),
      daysOutstanding: aging.daysOutstanding,
      agingBucket: aging.agingBucket,
    };
  }
}

function toDateOnly(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (Number.isNaN(value.getTime())) return null;
  return formatDateOnly(value);
}

/** Calendar fields, not toISOString: UTC would roll an evening timestamp to the next day. */
function formatDateOnly(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}
