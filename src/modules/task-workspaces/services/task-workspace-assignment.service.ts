import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../../entities/contact.entity';
import { Company } from '../../../entities/company.entity';
import { Lead } from '../../../entities/lead.entity';
import { Project } from '../../../entities/project.entity';
import { TaskWorkspace } from '../../../entities/task-workspace.entity';
import { TaskWorkspaceLink } from '../../../entities/task-workspace-link.entity';
import { TaskWorkspaceEntityKind } from '../../../entities/task-workspace-link.entity';
import { TaskWorkspacesRepository } from '../repositories/task-workspaces.repository';

export interface TaskWorkspaceAssignmentInput {
  workspaceId?: number;
  folderId?: number | null;
  entityKind?: TaskWorkspaceEntityKind | null;
  entityId?: number | null;
  actorId?: number | null;
}

@Injectable()
export class TaskWorkspaceAssignmentService {
  constructor(
    private readonly repository: TaskWorkspacesRepository,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(TaskWorkspaceLink) private readonly links: Repository<TaskWorkspaceLink>,
  ) {}

  async ensureGeneral(actorId?: number | null): Promise<TaskWorkspace> {
    const existing = await this.repository.findBySystemKey('general');
    if (existing) return existing;
    const workspace = new TaskWorkspace();
    workspace.title = 'General Tasks';
    workspace.workspaceType = 'system_default';
    workspace.systemKey = 'general';
    workspace.createdById = actorId ?? null;
    return this.repository.createIfMissing(workspace);
  }

  async ensureCanonicalLead(leadId: number, actorId?: number | null): Promise<TaskWorkspace> {
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);
    const existing = await this.repository.findByCanonicalLead(leadId);
    if (existing) return existing;

    const workspace = new TaskWorkspace();
    workspace.title = `${lead.leadNumber || lead.name || `Lead ${lead.id}`} Workspace`.slice(0, 160);
    workspace.workspaceType = 'custom';
    workspace.canonicalJobLeadId = leadId;
    workspace.createdById = actorId ?? null;
    const saved = await this.repository.createIfMissing(workspace);

    const link = new TaskWorkspaceLink();
    link.workspaceId = saved.id;
    link.entityKind = 'lead';
    link.entityId = leadId;
    link.relationship = 'primary';
    link.createdById = actorId ?? null;
    if (!(await this.repository.findLink(saved.id, 'lead', leadId))) await this.repository.addLink(link);
    return saved;
  }

  async archiveCanonicalLead(leadId: number): Promise<void> {
    const workspace = await this.repository.findByCanonicalLead(leadId);
    if (!workspace || workspace.systemKey === 'general' || workspace.archivedAt) return;
    workspace.archivedAt = new Date();
    await this.repository.create(workspace);
  }

  async removeEntityLinks(entityKind: TaskWorkspaceEntityKind, entityId: number): Promise<void> {
    await this.links.delete({ entityKind, entityId });
  }

  async resolveForTask(input: TaskWorkspaceAssignmentInput): Promise<{ workspaceId: number; folderId: number | null }> {
    let workspace: TaskWorkspace | null = null;
    if (input.workspaceId != null) {
      workspace = await this.repository.findActiveById(input.workspaceId);
      if (!workspace) throw new BadRequestException('Workspace is missing or archived');
    } else if (input.entityKind && input.entityId != null) {
      const canonicalLeadId = await this.resolveCanonicalLeadId(input.entityKind, input.entityId);
      workspace = canonicalLeadId != null
        ? await this.ensureCanonicalLead(canonicalLeadId, input.actorId)
        : await this.ensureGeneral(input.actorId);
    } else {
      workspace = await this.ensureGeneral(input.actorId);
    }

    const folderId = input.folderId ?? null;
    if (folderId != null) {
      const folder = await this.repository.findFolder(folderId);
      if (!folder || folder.workspaceId !== workspace.id) {
        throw new BadRequestException('Folder does not belong to the selected workspace');
      }
    }
    return { workspaceId: workspace.id, folderId };
  }

  async listOptions(): Promise<Array<{ id: number; title: string; archivedAt: string | null }>> {
    const general = await this.ensureGeneral();
    return [{ id: general.id, title: general.title, archivedAt: general.archivedAt?.toISOString() ?? null }];
  }

  private async resolveCanonicalLeadId(kind: TaskWorkspaceEntityKind, id: number): Promise<number | null> {
    if (kind === 'lead') {
      const lead = await this.leads.findOne({ where: { id }, select: ['id'] });
      if (!lead) throw new NotFoundException(`Lead ${id} not found`);
      return lead.id;
    }
    if (kind === 'project') {
      const project = await this.projects.findOne({ where: { id }, relations: ['lead'] });
      if (!project?.lead) throw new NotFoundException(`Project ${id} not found`);
      return project.lead.id;
    }
    if (kind === 'contact') {
      const contact = await this.contacts.findOne({ where: { id }, select: ['id'] });
      if (!contact) throw new NotFoundException(`Contact ${id} not found`);
      return null;
    }
    const company = await this.companies.findOne({ where: { id }, select: ['id'] });
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return null;
  }
}
