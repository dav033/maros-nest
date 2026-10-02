import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';
import {
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  type LeadLostReason,
  type LeadSource,
} from './lead-sales.constants';

// Re-exported: these used to be declared here, and the MCP tools and other callers import
// them from this path.
export {
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  type LeadLostReason,
  type LeadSource,
} from './lead-sales.constants';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  // `null` is accepted on all four and reaches the column as a real NULL: unassigning an
  // owner, dropping a follow-up date or correcting a source back to "unknown" have to be
  // expressible, not just setting them. @IsOptional() is what lets null through — it skips
  // validation for both null and undefined — while the service distinguishes the two.
  @ApiPropertyOptional({
    description: 'User id of the salesperson responsible for the lead; null unassigns',
    nullable: true,
  })
  @IsInt()
  @IsOptional()
  ownerId?: number | null;

  @ApiPropertyOptional({
    description: 'Acquisition channel',
    enum: LEAD_SOURCES,
    nullable: true,
  })
  @IsIn(LEAD_SOURCES)
  @IsOptional()
  source?: LeadSource | null;

  @ApiPropertyOptional({
    description: 'Why the deal was lost. Required on the update that moves a lead to LOST',
    enum: LEAD_LOST_REASONS,
    nullable: true,
  })
  @IsIn(LEAD_LOST_REASONS)
  @IsOptional()
  lostReason?: LeadLostReason | null;

  @ApiPropertyOptional({
    description: 'Date of the next planned contact (YYYY-MM-DD); null clears it',
    nullable: true,
  })
  @IsDateString()
  @IsOptional()
  nextFollowUpAt?: string | null;
}

export class UpdateLeadRequestDto {
  @ApiProperty({ type: UpdateLeadDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateLeadDto)
  lead: UpdateLeadDto;
}
