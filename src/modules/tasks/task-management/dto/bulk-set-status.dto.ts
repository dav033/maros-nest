import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_STATUSES } from '../../../../entities/task.entity';
import type { TaskStatus } from '../../../../entities/task.entity';

/** No beforeId/afterId — a bulk move always appends to the end of the target column, same as the detail view's single-task status dropdown. */
export class BulkSetStatusDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  taskIds: number[];

  @ApiProperty({ enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES)
  status: TaskStatus;

  @ApiPropertyOptional({
    description: 'Required if status is "blocked" and any selected task has no reason from before.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  blockedReason?: string;
}
