import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';

export class CreateProjectDto {
  @ApiPropertyOptional({ description: 'Progress status of the project', enum: ProjectProgressStatus })
  @IsEnum(ProjectProgressStatus)
  @IsOptional()
  projectProgressStatus?: ProjectProgressStatus;

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
