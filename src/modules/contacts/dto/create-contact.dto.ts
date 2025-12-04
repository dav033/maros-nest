import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean, IsNumber, IsArray, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContactDto {
  @ApiProperty({ description: 'Name of the contact', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'Occupation of the contact', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  occupation?: string;

  @ApiPropertyOptional({ description: 'Phone number', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ description: 'Email address', maxLength: 100 })
  @IsEmail()
  @IsOptional()
  @MaxLength(100)
  email?: string;

  @ApiPropertyOptional({ description: 'Address', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ description: 'Address link (Google Maps URL, etc.)', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  addressLink?: string;

  @ApiPropertyOptional({ description: 'Is the contact a customer?', default: false })
  @IsBoolean()
  @IsOptional()
  isCustomer?: boolean;

  @ApiPropertyOptional({ description: 'Is the contact a client?', default: false })
  @IsBoolean()
  @IsOptional()
  isClient?: boolean;

  @ApiPropertyOptional({ description: 'Company ID associated with the contact' })
  @IsNumber()
  @IsOptional()
  companyId?: number;

  @ApiPropertyOptional({ description: 'Notes for the contact', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  notes?: string[];
}
