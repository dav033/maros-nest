import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClickUpCustomFieldDto {
  @ApiProperty({ description: 'ID of the custom field' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Value of the custom field' })
  @IsObject()
  @IsNotEmpty()
  value: any;
}

export class ClickUpTaskRequestDto {
  @ApiProperty({ description: 'Name of the task' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the task' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Assignees IDs', type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  assignees?: number[];

  @ApiPropertyOptional({ description: 'Tags', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ description: 'Status of the task' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Priority of the task' })
  @IsNumber()
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({ description: 'Due date (timestamp)' })
  @IsNumber()
  @IsOptional()
  due_date?: number;

  @ApiPropertyOptional({ description: 'Start date (timestamp)' })
  @IsNumber()
  @IsOptional()
  start_date?: number;

  @ApiPropertyOptional({ description: 'Time estimate' })
  @IsNumber()
  @IsOptional()
  time_estimate?: number;

  @ApiPropertyOptional({ description: 'Custom fields', type: [ClickUpCustomFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClickUpCustomFieldDto)
  @IsOptional()
  custom_fields?: ClickUpCustomFieldDto[];
}
