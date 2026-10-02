import { IsString, IsNotEmpty, MaxLength, IsOptional, IsEnum, IsNumber, IsDateString, IsArray, ValidateNested, ValidateIf, IsBoolean, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { CreateContactDto } from '../../../contacts/contact-management/dto/create-contact.dto';
import { LEAD_SOURCES, type LeadSource } from './lead-sales.constants';

export class CreateLeadDto {
  @ApiPropertyOptional({ description: 'Lead number (auto-generated if not provided)', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  leadNumber?: string;

  @ApiPropertyOptional({ description: 'Name of the lead (auto-generated from leadNumber-location if not provided)', maxLength: 100 })
  @ValidateIf((o) => o.name !== undefined && o.name !== null)
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Start date of the lead (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Location', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ description: 'Address link (Google Maps URL, etc.)', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  addressLink?: string;

  @ApiProperty({ description: 'Status of the lead', enum: LeadStatus })
  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  /**
   * Accepted at creation, not only on a later update, because the channel is known at
   * intake and nowhere else. A field that needs a second request to fill is a field that
   * stays empty — which is the whole reason the funnel had no channel data to report on.
   *
   * `lostReason` and `nextFollowUpAt` deliberately stay update-only: neither is knowable
   * when a lead is born.
   *
   * `| null` is here only so UpdateLeadDto can keep widening these to "null clears the
   * value" — a subclass cannot narrow what PartialType inherited. On creation null and
   * omitted mean the same thing.
   */
  @ApiPropertyOptional({ description: 'Acquisition channel', enum: LEAD_SOURCES, nullable: true })
  @IsIn(LEAD_SOURCES)
  @IsOptional()
  source?: LeadSource | null;

  @ApiPropertyOptional({
    description: 'User id of the salesperson responsible for the lead',
    nullable: true,
  })
  @IsInt()
  @IsOptional()
  ownerId?: number | null;

  @ApiPropertyOptional({ description: 'Contact ID associated with the lead' })
  @IsNumber()
  @IsOptional()
  contactId?: number;

  @ApiPropertyOptional({ description: 'Project Type ID associated with the lead' })
  @IsNumber()
  @IsOptional()
  projectTypeId?: number;

  @ApiPropertyOptional({ description: 'Notes for the lead', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  notes?: string[];

  @ApiPropertyOptional({ description: 'Attachment S3 keys for the lead', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachments?: string[];

  @ApiPropertyOptional({ description: 'Manual estimated value of the lead (independent of QuickBooks)' })
  @IsNumber()
  @IsOptional()
  estimate?: number;

  @ApiPropertyOptional({ description: 'Whether the lead is in review', default: false })
  @IsBoolean()
  @IsOptional()
  inReview?: boolean;
}

export class CreateLeadWithNewContactDto {
  @ApiProperty({ description: 'Lead information' })
  @ValidateNested()
  @Type(() => CreateLeadDto)
  @IsNotEmpty()
  lead: CreateLeadDto;

  @ApiProperty({ description: 'New contact information' })
  @ValidateNested()
  @Type(() => CreateContactDto)
  @IsNotEmpty()
  contact: CreateContactDto;
}
