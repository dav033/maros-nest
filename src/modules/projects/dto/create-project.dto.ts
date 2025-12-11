import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsArray, IsBoolean, Min, ArrayMinSize, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { InvoiceStatus } from '../../../common/enums/invoice-status.enum';

export class CreateProjectDto {
  @ApiProperty({ description: 'Invoice amount', type: Number, example: 1000.50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  invoiceAmount?: number;

  @ApiPropertyOptional({ description: 'Payments made (array of numbers with 2 decimal places)', type: [Number], example: [500.00, 300.50] })
  @IsArray()
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @IsOptional()
  payments?: number[];

  @ApiPropertyOptional({ description: 'Progress status of the project', enum: ProjectProgressStatus })
  @IsEnum(ProjectProgressStatus)
  @IsOptional()
  projectProgressStatus?: ProjectProgressStatus;

  @ApiPropertyOptional({ description: 'Invoice status', enum: InvoiceStatus })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  invoiceStatus?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Is in QuickBooks?', default: false })
  @IsBoolean()
  @IsOptional()
  quickbooks?: boolean;

  @ApiPropertyOptional({ description: 'Project overview/description', type: String })
  @IsString()
  @IsOptional()
  overview?: string;

  @ApiPropertyOptional({ description: 'Project notes', type: [String], example: ['Note 1', 'Note 2'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  notes?: string[];

  @ApiProperty({ description: 'Lead ID associated with the project (required)', type: Number })
  @IsNumber()
  @IsNotEmpty()
  leadId: number;
}
