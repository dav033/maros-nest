import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { TASK_WORKSPACE_TYPES } from '../../../entities/task-workspace.entity';
import { TASK_WORKSPACE_ENTITY_KINDS, TASK_WORKSPACE_RELATIONSHIPS } from '../../../entities/task-workspace-link.entity';
import type { TaskWorkspaceEntityKind, TaskWorkspaceRelationship } from '../../../entities/task-workspace-link.entity';
import type { TaskWorkspaceType } from '../../../entities/task-workspace.entity';

export class TaskWorkspaceLinkInputDto {
  @IsIn(TASK_WORKSPACE_ENTITY_KINDS)
  entityKind: TaskWorkspaceEntityKind;

  @IsInt()
  entityId: number;

  @IsIn(TASK_WORKSPACE_RELATIONSHIPS)
  @IsOptional()
  relationship?: TaskWorkspaceRelationship;
}

export class CreateTaskWorkspaceDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsObject()
  @IsOptional()
  description?: Record<string, unknown>;

  @IsIn(TASK_WORKSPACE_TYPES)
  @IsOptional()
  workspaceType?: TaskWorkspaceType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskWorkspaceLinkInputDto)
  @IsOptional()
  links?: TaskWorkspaceLinkInputDto[];
}

export class UpdateTaskWorkspaceDto {
  @IsString()
  @MaxLength(160)
  @IsOptional()
  title?: string;

  @IsObject()
  @IsOptional()
  description?: Record<string, unknown> | null;
}

export class SearchTaskWorkspacesDto {
  @IsString()
  @MaxLength(160)
  @IsOptional()
  query?: string;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  includeArchived?: boolean;

  @IsIn(TASK_WORKSPACE_ENTITY_KINDS)
  @IsOptional()
  entityKind?: TaskWorkspaceEntityKind;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  entityId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}

export interface TaskWorkspaceLinkDto {
  workspaceId: number;
  entityKind: TaskWorkspaceEntityKind;
  entityId: number;
  relationship: TaskWorkspaceRelationship;
}

export interface TaskWorkspaceFolderDto {
  id: number;
  workspaceId: number;
  parentFolderId: number | null;
  title: string;
  position: number;
  children?: TaskWorkspaceFolderDto[];
}

export interface TaskWorkspaceFileDto {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
  status: 'pending' | 'ready' | 'failed';
  previewUrl?: string | null;
}

export interface TaskWorkspaceSummaryDto {
  id: number;
  title: string;
  workspaceType: TaskWorkspaceType;
  systemKey: string | null;
  archivedAt: string | null;
  linkCount: number;
  folderCount: number;
  taskCount: number;
  fileCount: number;
}

export interface TaskWorkspaceDetailDto extends TaskWorkspaceSummaryDto {
  description: Record<string, unknown> | null;
  descriptionText: string | null;
  links: TaskWorkspaceLinkDto[];
  folders: TaskWorkspaceFolderDto[];
  files: TaskWorkspaceFileDto[];
}
