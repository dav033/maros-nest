import { LeadStatus } from '../../../common/enums/lead-status.enum';

export type StaleAgeBucket = '0-29' | '30-59' | '60-89' | '90-179' | '180-364' | '365+';

export class StaleLeadDto {
  id: number;
  leadNumber: string | null;
  name: string | null;
  /** null is a real value here, and it is the oldest rot in the table. */
  status: LeadStatus | null;
  estimate: number;
  ageDays: number;
  ageBucket: StaleAgeBucket;
}

export class StaleAgeBucketDto {
  bucket: StaleAgeBucket;
  count: number;
  estimate: number;
}

export class StaleLeadsSummaryDto {
  totalCount: number;
  totalEstimate: number;
  buckets: StaleAgeBucketDto[];
  /** Undecided leads with no start_date: they cannot be aged, so they are not in `leads`. */
  undatedCount: number;
  undatedEstimate: number;
}

export class StaleLeadsDto {
  /** The threshold actually applied after clamping, not the one asked for. */
  days: number;
  /** The date the ages were measured against, so a cached payload can be read honestly. */
  asOf: string;
  leads: StaleLeadDto[];
  summary: StaleLeadsSummaryDto;
}
