import { IsString, IsOptional, IsNumber, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadType } from '../../../common/enums/lead-type.enum';

export class LeadIntakeRequestDto {
  // Company data
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

  // Contact data
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

  // Lead data
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
