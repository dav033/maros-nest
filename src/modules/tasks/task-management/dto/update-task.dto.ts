import {
  IsString,
  IsOptional,
  MaxLength,
  IsInt,
  IsIn,
  IsObject,
  IsDateString,
  IsArray,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_KINDS, TASK_PRIORITIES } from '../../../../entities/task.entity';
import type { TaskKind, TaskPriority } from '../../../../entities/task.entity';

/**
 * Generic patch for a task's own fields. Assignee and entity link each carry side
 * effects (watcher seeding, activity semantics) and go through their own endpoints —
 * see SetAssigneeDto / SetEntityDto. Status changes go exclusively through
 * `PATCH /tasks/:id/move`, even from the detail view (with no beforeId/afterId, it just
 * appends to the end of the new column) — one code path for every status transition,
 * board drag or not.
 *
 * No `parentId` here: reparenting after creation (promoting a subtask, demoting a
 * top-level task into one) is deferred to the subtask UI work — see PLAN-TAREAS.md PR4.
 * A subtask's parent is fixed at creation for now.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional({ description: 'Task title', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Description as TipTap document JSON' })
  @IsObject()
  @IsOptional()
  description?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'What kind of work this is', enum: TASK_KINDS })
  @IsIn(TASK_KINDS)
  @IsOptional()
  kind?: TaskKind;

  @ApiPropertyOptional({ description: 'Priority', enum: TASK_PRIORITIES })
  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Who is accountable for the task' })
  @IsInt()
  @IsOptional()
  reporterId?: number | null;

  @ApiPropertyOptional({ description: 'ISO date the work starts, or null to clear it' })
  @IsDateString()
  @IsOptional()
  startDate?: string | null;

  @ApiPropertyOptional({ description: 'ISO date the task is due, or null to clear it' })
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;

  @ApiPropertyOptional({
    description: 'Why the task is blocked. Editable independently of the status move.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  blockedReason?: string | null;

  @ApiPropertyOptional({
    description: 'Complete set of S3 attachment keys, in display order',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachments?: string[];
}
