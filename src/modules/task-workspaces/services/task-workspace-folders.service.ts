import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../../../entities/task.entity';
import { TaskWorkspaceFolder } from '../../../entities/task-workspace-folder.entity';
import { TaskWorkspace } from '../../../entities/task-workspace.entity';
import { CreateTaskWorkspaceFolderDto, UpdateTaskWorkspaceFolderDto } from '../dto/task-workspace.dto';
import { TaskWorkspaceFoldersRepository } from '../repositories/task-workspace-folders.repository';

@Injectable()
export class TaskWorkspaceFoldersService {
  constructor(
    private readonly repository: TaskWorkspaceFoldersRepository,
    @InjectRepository(TaskWorkspace) private readonly workspaces: Repository<TaskWorkspace>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
  ) {}

  async list(workspaceId: number) {
    await this.requireWorkspace(workspaceId);
    return this.repository.findByWorkspace(workspaceId);
  }

  async create(workspaceId: number, dto: CreateTaskWorkspaceFolderDto) {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.archivedAt) throw new BadRequestException('Archived workspaces are read-only');
    await this.assertParent(workspaceId, dto.parentFolderId ?? null);
    const folder = new TaskWorkspaceFolder();
    folder.workspaceId = workspaceId; folder.parentFolderId = dto.parentFolderId ?? null; folder.title = dto.title.trim(); folder.position = dto.position ?? Date.now();
    if (!folder.title) throw new BadRequestException('Folder title is required');
    return this.repository.save(folder);
  }

  async update(workspaceId: number, id: number, dto: UpdateTaskWorkspaceFolderDto) {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.archivedAt) throw new BadRequestException('Archived workspaces are read-only');
    const folder = await this.requireFolder(workspaceId, id);
    if (dto.title !== undefined) { folder.title = dto.title.trim(); if (!folder.title) throw new BadRequestException('Folder title is required'); }
    if (dto.parentFolderId !== undefined) {
      await this.assertParent(workspaceId, dto.parentFolderId);
      if (dto.parentFolderId === id) throw new BadRequestException('A folder cannot be its own parent');
      await this.assertNoCycle(workspaceId, id, dto.parentFolderId);
      folder.parentFolderId = dto.parentFolderId;
    }
    if (dto.position !== undefined) folder.position = dto.position;
    return this.repository.save(folder);
  }

  async remove(workspaceId: number, id: number, destinationFolderId?: number | null) {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.archivedAt) throw new BadRequestException('Archived workspaces are read-only');
    const folder = await this.requireFolder(workspaceId, id);
    const destination = destinationFolderId == null ? folder.parentFolderId ?? null : destinationFolderId;
    if (destination != null) await this.assertParent(workspaceId, destination);
    await this.tasks.createQueryBuilder().update(Task).set({ folderId: destination }).where('workspace_id = :workspaceId AND folder_id = :folderId', { workspaceId, folderId: id }).execute();
    await this.repository.remove(folder);
    return { deleted: true, relocatedToFolderId: destination };
  }

  private async requireWorkspace(id: number) { const workspace = await this.workspaces.findOne({ where: { id } }); if (!workspace) throw new NotFoundException(`Workspace ${id} not found`); return workspace; }
  private async requireFolder(workspaceId: number, id: number) { const folder = await this.repository.findById(id); if (!folder || folder.workspaceId !== workspaceId) throw new NotFoundException(`Folder ${id} not found in workspace`); return folder; }
  private async assertParent(workspaceId: number, parentId: number | null | undefined) { if (parentId == null) return; await this.requireFolder(workspaceId, parentId); }

  private async assertNoCycle(workspaceId: number, folderId: number, nextParentId: number | null) {
    let current = nextParentId; let depth = 0;
    while (current != null) {
      if (++depth > 50) throw new BadRequestException('Folder nesting exceeds the maximum depth');
      if (current === folderId) throw new BadRequestException('Folder move would create a cycle');
      const parent = await this.repository.findById(current);
      if (!parent || parent.workspaceId !== workspaceId) throw new BadRequestException('Folder parent is invalid');
      current = parent.parentFolderId ?? null;
    }
  }
}
