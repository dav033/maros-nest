import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { TASK_WORKSPACE_ENTITY_KINDS } from '../../../entities/task-workspace-link.entity';
import type { TaskWorkspaceEntityKind } from '../../../entities/task-workspace-link.entity';

export class TaskWorkspaceOptionsDto {
  @IsIn(TASK_WORKSPACE_ENTITY_KINDS)
  @IsOptional()
  entityKind?: TaskWorkspaceEntityKind;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  entityId?: number;
}
