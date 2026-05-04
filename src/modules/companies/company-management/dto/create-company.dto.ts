import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CompanyType } from '../../../../common/enums/company-type.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty({ description: 'Name of the company', maxLength: 150 })
  @ValidateIf((o) => o.name !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ description: 'Address of the company', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ description: 'Address link (Google Maps URL, etc.)', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  addressLink?: string;

  @ApiPropertyOptional({ description: 'Type of the company', enum: CompanyType })
  @IsEnum(CompanyType)
  @IsOptional()
  type?: CompanyType;

  @ApiPropertyOptional({ description: 'Service ID associated with the company' })
  @IsNumber()
  @IsOptional()
  serviceId?: number;

  @ApiPropertyOptional({ description: 'Is the company a customer?', default: false })
  @IsBoolean()
  @IsOptional()
  isCustomer?: boolean;

  @ApiPropertyOptional({ description: 'Is the company a client?', default: false })
  @IsBoolean()
  @IsOptional()
  isClient?: boolean;

  @ApiPropertyOptional({ description: 'Notes for the company', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  notes?: string[];

  @ApiPropertyOptional({ description: 'Phone number of the company', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  phone?: string;

  @ApiPropertyOptional({ description: 'Email address of the company', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Submiz field for the company', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  submiz?: string;

  @ApiPropertyOptional({ description: 'Linked QuickBooks vendor ID', maxLength: 64 })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  qboVendorId?: string;

  @ApiPropertyOptional({ description: 'Linked QuickBooks vendor display name', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  qboVendorName?: string;

  @ApiPropertyOptional({ description: 'QuickBooks vendor match confidence from 0 to 1' })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  qboVendorMatchConfidence?: number;

  @ApiPropertyOptional({ description: 'Timestamp when the QuickBooks vendor match was made' })
  @IsDateString()
  @IsOptional()
  qboVendorMatchedAt?: string;

  @ApiPropertyOptional({ description: 'Timestamp when the QuickBooks vendor match was last synced' })
  @IsDateString()
  @IsOptional()
  qboVendorLastSyncedAt?: string;
}
