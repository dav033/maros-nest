import { IsString, IsNotEmpty, MaxLength, IsOptional, IsEnum, IsNumber, IsDateString, IsArray, ValidateNested, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { CreateContactDto } from '../../contacts/dto/create-contact.dto';

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

  @ApiProperty({ description: 'Start date of the lead (YYYY-MM-DD)' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

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

  @ApiProperty({ description: 'Type of the lead', enum: LeadType })
  @IsEnum(LeadType)
  @IsOptional()
  leadType?: LeadType;

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
