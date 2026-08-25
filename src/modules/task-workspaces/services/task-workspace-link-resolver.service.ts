import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../../../entities/company.entity';
import { Contact } from '../../../entities/contact.entity';
import { Lead } from '../../../entities/lead.entity';
import { Project } from '../../../entities/project.entity';
import { TASK_WORKSPACE_ENTITY_KINDS } from '../../../entities/task-workspace-link.entity';
import type { TaskWorkspaceEntityKind } from '../../../entities/task-workspace-link.entity';

@Injectable()
export class TaskWorkspaceLinkResolverService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
  ) {}

  async assertExists(kind: TaskWorkspaceEntityKind, id: number): Promise<void> {
    if (!TASK_WORKSPACE_ENTITY_KINDS.includes(kind)) throw new BadRequestException('Unsupported workspace link kind');
    const exists = kind === 'lead'
      ? await this.leads.exists({ where: { id } })
      : kind === 'project'
        ? await this.projects.exists({ where: { id } })
        : kind === 'contact'
          ? await this.contacts.exists({ where: { id } })
          : await this.companies.exists({ where: { id } });
    if (!exists) throw new NotFoundException(`${kind} ${id} not found`);
  }
}
