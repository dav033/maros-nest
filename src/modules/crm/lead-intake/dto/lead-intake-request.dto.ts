import { IsString, IsOptional, IsNumber, IsEnum, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import {
  LEAD_SOURCES,
  type LeadSource,
} from '../../../leads/lead-management/dto/lead-sales.constants';

export class LeadIntakeRequestDto {
  @ApiPropertyOptional({ description: 'Existing company ID (if known)' })
  @IsNumber()
  @IsOptional()
  companyId?: number;

  @ApiPropertyOptional({ description: 'Company name', maxLength: 150 })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  companyName?: string;

  @ApiPropertyOptional({ description: 'Company email', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  companyEmail?: string;

  @ApiPropertyOptional({ description: 'Company address', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  companyAddress?: string;

  @ApiPropertyOptional({ description: 'Existing contact ID (if known)' })
  @IsNumber()
  @IsOptional()
  contactId?: number;

  @ApiPropertyOptional({ description: 'Contact name', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional({ description: 'Contact email', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  contactEmail?: string;

  @ApiProperty({ description: 'Lead location (usually email subject)', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  leadLocation: string;

  @ApiPropertyOptional({ description: 'Lead type', enum: LeadType, default: LeadType.CONSTRUCTION })
  @IsEnum(LeadType)
  @IsOptional()
  leadType?: LeadType;

  @ApiProperty({ description: 'Project type ID' })
  @IsNumber()
  projectTypeId: number;

  /**
   * The channel, when the caller knows it — a website form knows it is `website`, an
   * automation importing from a partner knows it is `partner`.
   *
   * Omitted is the normal case and is not a failure: processLeadIntake infers
   * `repeat_client` on its own when the contact or company already existed, which is the
   * one inference the data actually supports.
   */
  @ApiPropertyOptional({ description: 'Acquisition channel', enum: LEAD_SOURCES })
  @IsIn(LEAD_SOURCES)
  @IsOptional()
  source?: LeadSource;
}

export class LeadIntakeResponseDto {
  @ApiProperty({ description: 'Created lead' })
  lead: any;

  @ApiProperty({ description: 'Company (created or found)' })
  company: any;

  @ApiProperty({ description: 'Contact (created or found)' })
  contact: any;

  @ApiProperty({ description: 'Actions performed' })
  actions: string[];
}
