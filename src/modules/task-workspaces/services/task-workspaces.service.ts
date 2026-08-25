import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TaskFile } from '../../../entities/task-file.entity';
import { Task } from '../../../entities/task.entity';
import { TaskWorkspace } from '../../../entities/task-workspace.entity';
import { TaskWorkspaceFolder } from '../../../entities/task-workspace-folder.entity';
import { TaskWorkspaceLink } from '../../../entities/task-workspace-link.entity';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { extractPlainTextFromTipTapDoc } from '../../../common/utils/tiptap-text.util';
import { AddTaskWorkspaceLinksDto, CreateTaskWorkspaceDto, SearchTaskWorkspacesDto, UpdateTaskWorkspaceDto } from '../dto/task-workspace.dto';
import { TaskWorkspaceMapper } from '../mappers/task-workspace.mapper';
import { TaskWorkspaceLinkResolverService } from './task-workspace-link-resolver.service';
import { TaskWorkspacesRepository } from '../repositories/task-workspaces.repository';

@Injectable()
export class TaskWorkspacesService {
  constructor(
    private readonly repository: TaskWorkspacesRepository,
    private readonly mapper: TaskWorkspaceMapper,
    private readonly linkResolver: TaskWorkspaceLinkResolverService,
    @InjectRepository(TaskWorkspace) private readonly workspaces: Repository<TaskWorkspace>,
    @InjectRepository(TaskWorkspaceFolder) private readonly folders: Repository<TaskWorkspaceFolder>,
    @InjectRepository(TaskWorkspaceLink) private readonly links: Repository<TaskWorkspaceLink>,
    @InjectRepository(TaskFile) private readonly files: Repository<TaskFile>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
  ) {}

  async list(query: SearchTaskWorkspacesDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const qb = this.workspaces.createQueryBuilder('workspace');
    if (!query.includeArchived) qb.andWhere('workspace.archived_at IS NULL');
    if (query.query?.trim()) qb.andWhere('workspace.title ILIKE :query', { query: `%${query.query.trim()}%` });
    if (query.entityKind && query.entityId != null) {
      qb.andWhere((sub) => {
        const exists = sub.subQuery().select('1').from(TaskWorkspaceLink, 'link').where('link.workspace_id = workspace.id').andWhere('link.entity_kind = :entityKind').andWhere('link.entity_id = :entityId').getQuery();
        return `EXISTS ${exists}`;
      }).setParameters({ entityKind: query.entityKind, entityId: query.entityId });
    }
    const [rows, totalCount] = await qb.orderBy('workspace.archived_at', 'ASC', 'NULLS FIRST').addOrderBy('workspace.title', 'ASC').skip((page - 1) * limit).take(limit).getManyAndCount();
    const items = await Promise.all(rows.map(async (row) => this.mapper.toSummaryDto(row, await this.counts(row.id))));
    return { items, totalCount, page, limit };
  }

  async get(id: number) {
    const workspace = await this.workspaces.findOne({ where: { id } });
    if (!workspace) throw new NotFoundException(`Workspace ${id} not found`);
    const [links, folders, files, counts] = await Promise.all([
      this.links.find({ where: { workspaceId: id }, order: { createdAt: 'ASC' } }),
      this.folders.find({ where: { workspaceId: id }, order: { position: 'ASC', id: 'ASC' } }),
      this.files.find({ where: { workspaceId: id, status: 'ready', deletedAt: IsNull() }, order: { position: 'ASC', id: 'ASC' } }),
      this.counts(id),
    ]);
    return this.mapper.toDetailDto(workspace, { links, folders, files, counts });
  }

  async create(dto: CreateTaskWorkspaceDto, actor: AuthenticatedUser) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Workspace title is required');
    const workspace = new TaskWorkspace();
    workspace.title = title;
    workspace.description = dto.description ?? null;
    workspace.descriptionText = dto.description ? extractPlainTextFromTipTapDoc(dto.description) : null;
    workspace.workspaceType = 'custom';
    workspace.createdById = actor.id;
    const saved = await this.workspaces.save(workspace);
    if (dto.links?.length) await this.addLinks(saved.id, { links: dto.links }, actor);
    return this.get(saved.id);
  }

  async update(id: number, dto: UpdateTaskWorkspaceDto) {
    const workspace = await this.require(id);
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Workspace title is required');
      workspace.title = title;
    }
    if (dto.description !== undefined) {
      workspace.description = dto.description;
      workspace.descriptionText = dto.description ? extractPlainTextFromTipTapDoc(dto.description) : null;
    }
    await this.workspaces.save(workspace);
    return this.get(id);
  }

  async archive(id: number): Promise<void> {
    const workspace = await this.require(id);
    if (workspace.systemKey === 'general') throw new BadRequestException('General Tasks cannot be archived');
    workspace.archivedAt = new Date();
    await this.workspaces.save(workspace);
  }

  async restore(id: number) {
    const workspace = await this.require(id);
    workspace.archivedAt = null;
    await this.workspaces.save(workspace);
    return this.get(id);
  }

  async addLinks(id: number, dto: AddTaskWorkspaceLinksDto, actor: AuthenticatedUser) {
    const workspace = await this.require(id);
    if (workspace.archivedAt) throw new BadRequestException('Archived workspaces are read-only');
    for (const input of dto.links ?? []) {
      await this.linkResolver.assertExists(input.entityKind, input.entityId);
      const link = await this.links.findOne({ where: { workspaceId: id, entityKind: input.entityKind, entityId: input.entityId } });
      if (!link) {
        const created = new TaskWorkspaceLink();
        created.workspaceId = id; created.entityKind = input.entityKind; created.entityId = input.entityId; created.relationship = input.relationship ?? 'related'; created.createdById = actor.id;
        await this.links.save(created);
      }
    }
    return this.get(id);
  }

  async removeLink(id: number, kind: string, entityId: number) {
    const workspace = await this.require(id);
    if (workspace.systemKey === 'general') throw new BadRequestException('General Tasks links cannot be changed');
    const link = await this.links.findOne({ where: { workspaceId: id, entityKind: kind as any, entityId } });
    if (!link) throw new NotFoundException('Workspace link not found');
    if (link.relationship === 'primary' && kind === 'lead' && workspace.canonicalJobLeadId === entityId) throw new BadRequestException('Canonical lead link is protected');
    await this.links.remove(link);
    return this.get(id);
  }

  async moveTask(workspaceId: number, taskId: number, folderId?: number | null) {
    const workspace = await this.require(workspaceId);
    if (workspace.archivedAt) throw new BadRequestException('Archived workspaces are read-only');
    const task = await this.tasks.findOne({ where: { id: taskId, deletedAt: IsNull() } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    if (folderId != null) {
      const folder = await this.folders.findOne({ where: { id: folderId, workspaceId } });
      if (!folder) throw new BadRequestException('Folder does not belong to workspace');
    }
    task.workspaceId = workspaceId;
    task.folderId = folderId ?? null;
    task.workspacePosition = Date.now();
    await this.tasks.save(task);
    return task;
  }

  private async require(id: number) { const workspace = await this.repository.findById(id); if (!workspace) throw new NotFoundException(`Workspace ${id} not found`); return workspace; }

  private async counts(id: number) {
    const [linkCount, folderCount, taskCount, fileCount] = await Promise.all([
      this.links.count({ where: { workspaceId: id } }),
      this.folders.count({ where: { workspaceId: id } }),
      this.tasks.count({ where: { workspaceId: id, deletedAt: IsNull() } }),
      this.files.count({ where: { workspaceId: id, deletedAt: IsNull() } }),
    ]);
    return { linkCount, folderCount, taskCount, fileCount };
  }
}
