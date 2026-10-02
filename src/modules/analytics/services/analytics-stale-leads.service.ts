import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { StaleLeadDto, StaleLeadsDto } from '../dto/stale-leads.dto';
import {
  DEFAULT_STALE_DAYS,
  UNDECIDED_LEAD_STATUSES,
  ageInDays,
  staleAgeBucket,
  summarizeStaleLeads,
} from '../utils/stale-leads.util';

interface RawUndecidedLeadRow {
  id: number;
  leadNumber: string | null;
  name: string | null;
  status: LeadStatus | null;
  estimate: string | number | null;
  startDate: Date | string | null;
}

/**
 * The leads nobody has declared dead.
 *
 * Roughly a third of the pipeline sits in an undecided status, the oldest of it well over
 * a year old, which inflates every reported pipeline number and hides the real conversion
 * rate. This view puts an age and an amount on that so somebody can close them out.
 */
@Injectable()
export class AnalyticsStaleLeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
  ) {}

  /**
   * Age is measured from leads.start_date, which is an approximation and has to be read
   * as one.
   *
   * The table has no created_at and no updated_at, so "has not moved in N days" is really
   * "opened N days ago": a lead touched yesterday still reads as stale if it opened a year
   * ago, and a revived old lead cannot be told from a dead one. The number is a floor on
   * how long the lead has been undecided, never a measure of silence. When a
   * status_changed_at column exists this should measure from it; nothing here reads such a
   * column, because today there is none.
   */
  async getStaleLeads(days?: number): Promise<StaleLeadsDto> {
    const thresholdDays = Math.max(
      1,
      Math.min(3650, Math.trunc(days || DEFAULT_STALE_DAYS)),
    );
    const asOf = new Date();

    const rows = await this.loadUndecidedLeads();

    const leads: StaleLeadDto[] = [];
    const undated = { count: 0, estimate: 0 };

    for (const row of rows) {
      const estimate = Number(row.estimate) || 0;

      // No start_date, no age. Reported as a count of their own rather than assumed
      // ancient or assumed fresh — guessing either way would be inventing the number the
      // view exists to stop inventing.
      if (row.startDate === null) {
        undated.count += 1;
        undated.estimate += estimate;
        continue;
      }

      const age = ageInDays(row.startDate, asOf);
      if (age <= thresholdDays) continue;

      leads.push({
        id: Number(row.id),
        leadNumber: row.leadNumber,
        name: row.name,
        status: row.status,
        estimate,
        ageDays: age,
        ageBucket: staleAgeBucket(age),
      });
    }

    leads.sort((a, b) => b.ageDays - a.ageDays || a.id - b.id);

    return {
      days: thresholdDays,
      asOf: asOf.toISOString(),
      leads,
      summary: summarizeStaleLeads(leads, undated),
    };
  }

  /**
   * Every undecided lead, aged in memory rather than filtered by date in SQL: the undated
   * ones have to be counted too, and a WHERE on start_date would drop exactly those. The
   * table is a few hundred rows.
   */
  private async loadUndecidedLeads(): Promise<RawUndecidedLeadRow[]> {
    return this.leads
      .createQueryBuilder('lead')
      .select('lead.id', 'id')
      .addSelect('lead.leadNumber', 'leadNumber')
      .addSelect('lead.name', 'name')
      .addSelect('lead.status', 'status')
      .addSelect('lead.estimate', 'estimate')
      .addSelect('lead.startDate', 'startDate')
      .where('(lead.status IS NULL OR lead.status IN (:...undecided))', {
        undecided: [...UNDECIDED_LEAD_STATUSES],
      })
      .getRawMany<RawUndecidedLeadRow>();
  }
}
