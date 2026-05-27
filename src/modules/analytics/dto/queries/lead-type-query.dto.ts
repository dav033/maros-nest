import { IsEnum, IsOptional } from 'class-validator';
import { LeadType } from '../../../../common/enums/lead-type.enum';

export class LeadTypeQueryDto {
  @IsOptional()
  @IsEnum(LeadType, {
    message: '"leadType" must be one of CONSTRUCTION, PLUMBING, ROOFING',
  })
  leadType?: LeadType;
}
