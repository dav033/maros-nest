import { LeadStatus } from '../../../common/enums/lead-status.enum';

export class PipelineBucketDto {
  status: LeadStatus;
  count: number;
  estimatedValue: number;
}
