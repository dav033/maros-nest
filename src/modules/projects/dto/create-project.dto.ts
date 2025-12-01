import { IsString, IsNotEmpty, MaxLength, IsOptional, IsEnum, IsNumber, IsDateString, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { InvoiceStatus } from '../../../common/enums/invoice-status.enum';

export class CreateProjectDto {
  @ApiProperty({ description: 'Name of the project', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  projectName: string;

  @ApiPropertyOptional({ description: 'Overview of the project' })
  @IsString()
  @IsOptional()
  overview?: string;

  @ApiPropertyOptional({ description: 'Payments made', type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  payments?: number[];

  @ApiPropertyOptional({ description: 'Status of the project', enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  @IsOptional()
  projectStatus?: ProjectStatus;

  @ApiPropertyOptional({ description: 'Invoice status', enum: InvoiceStatus })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  invoiceStatus?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Is in QuickBooks?', default: false })
  @IsBoolean()
  @IsOptional()
  quickbooks?: boolean;

  @ApiPropertyOptional({ description: 'Start date' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Lead ID associated with the project' })
  @IsNumber()
  @IsOptional()
  leadId?: number;
}
