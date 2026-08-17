import { IsDateString, IsInt, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ScheduleTaskDto {
  @ApiPropertyOptional({ description: 'ISO date the work starts, or null to clear it', nullable: true })
  @IsDateString()
  @IsOptional()
  startDate?: string | null;

  @ApiPropertyOptional({ description: 'ISO date the task is due, or null to clear it', nullable: true })
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;

  @ApiPropertyOptional({ description: 'User id to assign, or null to unassign', nullable: true })
  @ValidateIf((dto: ScheduleTaskDto) => dto.assigneeUserId !== null)
  @IsInt()
  @IsOptional()
  assigneeUserId?: number | null;
}
