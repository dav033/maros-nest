import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_STATUSES } from '../../../../entities/task.entity';
import type { TaskStatus } from '../../../../entities/task.entity';

/**
 * The board's drag endpoint — and also what the detail view's status dropdown calls,
 * just without beforeId/afterId (append to the end of the new column). One code path
 * for every status transition.
 */
export class MoveTaskDto {
  @ApiProperty({ description: 'Target status column', enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES)
  status: TaskStatus;

  @ApiPropertyOptional({ description: 'Insert before this sibling id (same column)' })
  @IsInt()
  @IsOptional()
  beforeId?: number | null;

  @ApiPropertyOptional({ description: 'Insert after this sibling id (same column)' })
  @IsInt()
  @IsOptional()
  afterId?: number | null;

  @ApiPropertyOptional({
    description:
      'Required the first time a task moves to blocked (unless it already carries a ' +
      'reason from before). Ignored for every other target status.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  blockedReason?: string;

  @ApiPropertyOptional({ description: 'Required when a task is moved to cancelled' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  cancelledReason?: string;
}
