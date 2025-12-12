import { IsString, IsArray, ValidateNested, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RestorationVisitActivityDto } from './restoration-visit-activity.dto';

export class RestorationVisitDto {
  @ApiProperty({ description: 'Lead number', type: String })
  @IsString()
  @IsNotEmpty()
  lead_number: string;

  @ApiProperty({ description: 'Language', type: String })
  @IsString()
  @IsNotEmpty()
  language: string;

  @ApiProperty({ 
    description: 'Activities', 
    type: [RestorationVisitActivityDto] 
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestorationVisitActivityDto)
  activities: RestorationVisitActivityDto[];

  @ApiPropertyOptional({ 
    description: 'Additional activities', 
    type: [RestorationVisitActivityDto] 
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestorationVisitActivityDto)
  @IsOptional()
  additional_activities?: RestorationVisitActivityDto[];

  @ApiPropertyOptional({ 
    description: 'Next activities', 
    type: [String] 
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  next_activities?: string[];

  @ApiPropertyOptional({ 
    description: 'Observations', 
    type: [String] 
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  observations?: string[];
}

