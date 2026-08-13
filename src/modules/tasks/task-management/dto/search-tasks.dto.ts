import { IsString, IsOptional, IsInt, IsIn, IsBoolean, IsDateString, IsArray } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_KINDS, TASK_PRIORITIES, TASK_STATUSES } from '../../../../entities/task.entity';
import type { TaskKind, TaskPriority, TaskStatus } from '../../../../entities/task.entity';
import { TASK_ENTITY_KINDS } from './create-task.dto';
import type { TaskEntityKind } from './create-task.dto';
import { toArray } from './toArray.util';

/**
 * Query filters for GET /tasks. Every field is an AND with the rest.
 *
 * `status`/`assigneeUserId`/`kind`/`priority`/`labelId` each accept either one value
 * or several — a client sends `status=todo` for one, `status[]=todo&status[]=done`
 * (axios's default array serialization) for several, and this DTO normalizes both to
 * an array (see toArray). Multiple values within one field are OR'd together; the
 * fields themselves stay AND'd, same as before.
 */
export class SearchTasksDto {
  @ApiPropertyOptional({ enum: TASK_STATUSES, isArray: true })
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @IsIn(TASK_STATUSES, { each: true })
  @IsOptional()
  status?: TaskStatus[];

  @ApiPropertyOptional({ type: [Number] })
  @Transform(({ value }) => toArray(value)?.map(Number))
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  assigneeUserId?: number[];

  @ApiPropertyOptional({ enum: TASK_KINDS, isArray: true })
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @IsIn(TASK_KINDS, { each: true })
  @IsOptional()
  kind?: TaskKind[];

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, isArray: true })
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @IsIn(TASK_PRIORITIES, { each: true })
  @IsOptional()
  priority?: TaskPriority[];

  @ApiPropertyOptional({ type: [Number] })
  @Transform(({ value }) => toArray(value)?.map(Number))
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  labelId?: number[];

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
