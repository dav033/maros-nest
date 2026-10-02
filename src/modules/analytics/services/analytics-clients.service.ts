import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { ClientScorecardRowDto } from '../dto/client-scorecard.dto';
import {
  ClientLeadRow,
  aggregateClientScorecard,
} from '../utils/client-scorecard.util';

/** Raw shape of the join; every aggregate-free column arrives as pg hands it over. */
interface RawClientLeadRow {
  contactId: number;
  contactName: string | null;
  companyId: number | null;
  companyName: string | null;
  status: LeadStatus | null;
  estimate: string | number | null;
  startDate: Date | string | null;
}

const DEFAULT_SCORECARD_LIMIT = 50;

/**
 * The per-client view of the lead history.
 *
 * Reads the leads table through its own repository instead of LeadsService: the existing
 * lead read paths hydrate contact, company, project type and project for the list UI, and
 * this needs seven columns of several hundred rows.
 */
@Injectable()
export class AnalyticsClientsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
  ) {}

  async getClientScorecard(limit?: number): Promise<ClientScorecardRowDto[]> {
    const safeLimit = Math.max(
      1,
      Math.min(500, Math.trunc(limit || DEFAULT_SCORECARD_LIMIT)),
    );

    const scorecard = aggregateClientScorecard(await this.loadClientLeads());
    return scorecard.slice(0, safeLimit);
  }

  /**
   * Grouped by contact, not by company.
   *
   * A contact's company is optional in this CRM and most of the repeat business is
   * residential, so grouping by company would put the majority of clients in one
   * unnamed bucket and merge the ones that do have a firm into a row that no longer
   * names anybody to call. The company is carried on each row instead, which lets the
   * frontend roll up by firm without the backend having to pick one dimension.
   *
   * innerJoin on the contact: a lead with no contact belongs to no client and cannot be
   * attributed to one, so it is left out rather than collected under a null row.
   */
  private async loadClientLeads(): Promise<ClientLeadRow[]> {
    const rows = await this.leads
      .createQueryBuilder('lead')
      .innerJoin('lead.contact', 'contact')
      .leftJoin('contact.company', 'company')
      .select('contact.id', 'contactId')
      .addSelect('contact.name', 'contactName')
      .addSelect('company.id', 'companyId')
      .addSelect('company.name', 'companyName')
      .addSelect('lead.status', 'status')
      .addSelect('lead.estimate', 'estimate')
      .addSelect('lead.startDate', 'startDate')
      .getRawMany<RawClientLeadRow>();

    return rows.map((row) => ({
      contactId: Number(row.contactId),
      contactName: row.contactName,
      companyId: row.companyId === null ? null : Number(row.companyId),
      companyName: row.companyName,
      status: row.status,
      // decimal comes back as a string from pg; Number('') would be 0 but null must stay null.
      estimate: row.estimate === null ? null : Number(row.estimate) || 0,
      startDate: toDateOnly(row.startDate),
    }));
  }
}

/** YYYY-MM-DD, whichever of the two shapes the driver used for the DATE column. */
function toDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return value.slice(0, 10);
}
