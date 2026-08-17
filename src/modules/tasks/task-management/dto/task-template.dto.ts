import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { TASK_KINDS, TASK_PRIORITIES } from '../../../../entities/task.entity';
import type { TaskKind, TaskPriority } from '../../../../entities/task.entity';

export class TaskTemplateItemDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsIn(TASK_KINDS)
  @IsOptional()
  kind?: TaskKind;

  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: TaskPriority;

  @IsInt()
  @Min(0)
  @IsOptional()
  offsetDays?: number;
}

export class CreateTaskTemplateDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  projectType?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskTemplateItemDto)
  items: TaskTemplateItemDto[];
}
