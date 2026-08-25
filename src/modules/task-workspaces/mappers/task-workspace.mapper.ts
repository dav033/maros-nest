import type { TaskFile } from '../../../entities/task-file.entity';
import type { TaskWorkspace } from '../../../entities/task-workspace.entity';
import type { TaskWorkspaceFolder } from '../../../entities/task-workspace-folder.entity';
import type { TaskWorkspaceLink } from '../../../entities/task-workspace-link.entity';
import type { TaskWorkspaceDetailDto, TaskWorkspaceFileDto, TaskWorkspaceFolderDto, TaskWorkspaceLinkDto, TaskWorkspaceSummaryDto } from '../dto/task-workspace.dto';

export class TaskWorkspaceMapper {
  toLinkDto(link: TaskWorkspaceLink): TaskWorkspaceLinkDto {
    return {
      workspaceId: link.workspaceId,
      entityKind: link.entityKind,
      entityId: link.entityId,
      relationship: link.relationship,
    };
  }

  toFolderDto(folder: TaskWorkspaceFolder, children?: TaskWorkspaceFolderDto[]): TaskWorkspaceFolderDto {
    return {
      id: folder.id,
      workspaceId: folder.workspaceId,
      parentFolderId: folder.parentFolderId ?? null,
      title: folder.title,
      position: Number(folder.position ?? 0),
      children,
    };
  }

  toFileDto(file: TaskFile, previewUrl: string | null = null): TaskWorkspaceFileDto {
    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      position: Number(file.position ?? 0),
      status: file.status,
      previewUrl,
    };
  }

  toSummaryDto(workspace: TaskWorkspace, counts: Partial<Pick<TaskWorkspaceSummaryDto, 'linkCount' | 'folderCount' | 'taskCount' | 'fileCount'>> = {}): TaskWorkspaceSummaryDto {
    return {
      id: workspace.id,
      title: workspace.title.trim(),
      workspaceType: workspace.workspaceType,
      systemKey: workspace.systemKey ?? null,
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
      linkCount: counts.linkCount ?? 0,
      folderCount: counts.folderCount ?? 0,
      taskCount: counts.taskCount ?? 0,
      fileCount: counts.fileCount ?? 0,
    };
  }

  toDetailDto(
    workspace: TaskWorkspace,
    input: {
      links?: TaskWorkspaceLink[];
      folders?: TaskWorkspaceFolder[];
      files?: TaskFile[];
      counts?: Partial<Pick<TaskWorkspaceSummaryDto, 'linkCount' | 'folderCount' | 'taskCount' | 'fileCount'>>;
    } = {},
  ): TaskWorkspaceDetailDto {
    return {
      ...this.toSummaryDto(workspace, input.counts),
      description: workspace.description ?? null,
      descriptionText: workspace.descriptionText ?? null,
      links: (input.links ?? []).map((link) => this.toLinkDto(link)),
      folders: (input.folders ?? []).map((folder) => this.toFolderDto(folder)),
      files: (input.files ?? []).map((file) => this.toFileDto(file)),
    };
  }
}
