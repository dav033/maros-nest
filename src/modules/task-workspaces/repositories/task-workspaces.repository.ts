import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TaskWorkspace } from '../../../entities/task-workspace.entity';
import { TaskWorkspaceFolder } from '../../../entities/task-workspace-folder.entity';
import { TaskWorkspaceLink } from '../../../entities/task-workspace-link.entity';
import { Task } from '../../../entities/task.entity';

@Injectable()
export class TaskWorkspacesRepository {
  constructor(
    @InjectRepository(TaskWorkspace) private readonly workspaces: Repository<TaskWorkspace>,
    @InjectRepository(TaskWorkspaceFolder) private readonly folders: Repository<TaskWorkspaceFolder>,
    @InjectRepository(TaskWorkspaceLink) private readonly links: Repository<TaskWorkspaceLink>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
  ) {}

  findById(id: number): Promise<TaskWorkspace | null> {
    return this.workspaces.findOne({ where: { id } });
  }

  findActiveById(id: number): Promise<TaskWorkspace | null> {
    return this.workspaces.findOne({ where: { id, archivedAt: IsNull() } });
  }

  findBySystemKey(systemKey: string): Promise<TaskWorkspace | null> {
    return this.workspaces.findOne({ where: { systemKey } });
  }

  findByCanonicalLead(leadId: number): Promise<TaskWorkspace | null> {
    return this.workspaces.findOne({ where: { canonicalJobLeadId: leadId } });
  }

  async create(workspace: TaskWorkspace): Promise<TaskWorkspace> {
    return this.workspaces.save(workspace);
  }

  async createIfMissing(workspace: TaskWorkspace): Promise<TaskWorkspace> {
    try {
      await this.workspaces.insert(workspace as any);
    } catch {
      // Unique races are expected for General/canonical workspace provisioning.
    }
    const key = workspace.systemKey ?? undefined;
    const saved = key
      ? await this.findBySystemKey(key)
      : workspace.canonicalJobLeadId != null
        ? await this.findByCanonicalLead(workspace.canonicalJobLeadId)
        : null;
    if (!saved) throw new Error('Workspace could not be provisioned');
    return saved;
  }

  findFolder(id: number): Promise<TaskWorkspaceFolder | null> {
    return this.folders.findOne({ where: { id } });
  }

  findLink(workspaceId: number, entityKind: string, entityId: number): Promise<TaskWorkspaceLink | null> {
    return this.links.findOne({ where: { workspaceId, entityKind: entityKind as any, entityId } });
  }

  async addLink(link: TaskWorkspaceLink): Promise<TaskWorkspaceLink> {
    return this.links.save(link);
  }

  async countFor(workspaceId: number): Promise<{ linkCount: number; folderCount: number; taskCount: number; fileCount: number }> {
    const [linkCount, folderCount, taskCount] = await Promise.all([
      this.links.count({ where: { workspaceId } }),
      this.folders.count({ where: { workspaceId } }),
      this.tasks.count({ where: { workspaceId, deletedAt: IsNull() } }),
    ]);
    return { linkCount, folderCount, taskCount, fileCount: 0 };
  }
}
