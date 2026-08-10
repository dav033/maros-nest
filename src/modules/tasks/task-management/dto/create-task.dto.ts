import {
  IsString,
  IsOptional,
  MaxLength,
  IsInt,
  IsIn,
  IsObject,
  IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_KINDS, TASK_PRIORITIES } from '../../../../entities/task.entity';
import type { TaskKind, TaskPriority } from '../../../../entities/task.entity';

export const TASK_ENTITY_KINDS = ['lead', 'project', 'contact', 'company'] as const;
export type TaskEntityKind = (typeof TASK_ENTITY_KINDS)[number];

export class CreateTaskDto {
  @ApiPropertyOptional({ description: 'Task title', maxLength: 255, default: 'Untitled task' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Description as TipTap document JSON' })
  @IsObject()
  @IsOptional()
  description?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'What kind of work this is', enum: TASK_KINDS, default: 'general' })
  @IsIn(TASK_KINDS)
  @IsOptional()
  kind?: TaskKind;

  @ApiPropertyOptional({ description: 'Priority', enum: TASK_PRIORITIES, default: 'normal' })
  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: TaskPriority;

  @ApiPropertyOptional({
    description: 'Parent task id — creates a subtask. The parent must not itself be a subtask.',
  })
  @IsInt()
  @IsOptional()
  parentId?: number;

  @ApiPropertyOptional({ description: 'User id to assign the task to' })
  @IsInt()
  @IsOptional()
  assigneeUserId?: number;

  @ApiPropertyOptional({
    description: 'Who is accountable for the task. Defaults to the creator.',
  })
  @IsInt()
  @IsOptional()
  reporterId?: number;

  @ApiPropertyOptional({ description: 'CRM entity kind this task is linked to', enum: TASK_ENTITY_KINDS })
  @IsIn(TASK_ENTITY_KINDS)
  @IsOptional()
  entityKind?: TaskEntityKind;

  @ApiPropertyOptional({ description: 'CRM entity id this task is linked to' })
  @IsInt()
  @IsOptional()
  entityId?: number;

  @ApiPropertyOptional({ description: 'ISO date the work starts' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date the task is due' })
  @IsDateString()
  @IsOptional()
  dueDate?: string;
}
