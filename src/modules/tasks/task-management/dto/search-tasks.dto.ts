import { IsString, IsOptional, IsInt, IsIn, IsBoolean, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_KINDS, TASK_PRIORITIES, TASK_STATUSES } from '../../../../entities/task.entity';
import type { TaskKind, TaskPriority, TaskStatus } from '../../../../entities/task.entity';
import { TASK_ENTITY_KINDS } from './create-task.dto';
import type { TaskEntityKind } from './create-task.dto';

/** Query filters for GET /tasks. Every field is an AND with the rest. */
export class SearchTasksDto {
  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  assigneeUserId?: number;

  @ApiPropertyOptional({ enum: TASK_KINDS })
  @IsIn(TASK_KINDS)
  @IsOptional()
  kind?: TaskKind;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  labelId?: number;

  @ApiPropertyOptional({ enum: TASK_ENTITY_KINDS })
  @IsIn(TASK_ENTITY_KINDS)
  @IsOptional()
  entityKind?: TaskEntityKind;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  entityId?: number;

  @ApiPropertyOptional({ description: 'Only tasks due on or before this ISO date' })
  @IsDateString()
  @IsOptional()
  dueBefore?: string;

  @ApiPropertyOptional({
    description: 'Include subtasks in the results. Off by default — the board and list read top-level only.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  includeSubtasks?: boolean;

  @ApiPropertyOptional({ description: 'Full-text search over title and description' })
  @IsString()
  @IsOptional()
  q?: string;
}
