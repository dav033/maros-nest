import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { Contact } from '../../../../entities/contact.entity';
import { Company } from '../../../../entities/company.entity';
import { TaskEntityKind } from '../dto/create-task.dto';

export interface TaskEntityRef {
  kind: TaskEntityKind;
  id: number;
  /** The record's own name — "Lead #123" is a fallback for the (rare) unnamed lead, never the norm. */
  label: string;
  href: string;
  leadNumber?: string;
  address?: string;
  addressLink?: string;
  status?: string;
}

interface EntityLink {
  entityKind: TaskEntityKind;
  entityId: number;
}

/**
 * Turns the (entityKind, entityId) pairs tasks carry into what a person actually needs
 * to see — a name, an address, a link — without the board/list/detail views each
 * re-deriving it (see JobAddressLink, which this replaces on the frontend side; and
 * TaskListTable's old "Lead #123" rendering).
 *
 * One grouped query per entity kind, `WHERE id = ANY(...)`, never one per task — same
 * shape as TasksRepository.countSubtasksByParents / countCommentsByTasks. A project
 * has no name of its own; it's a won lead, so its label/address/leadNumber all come
 * through `project.lead` (see ProjectEntity — same relation deriveJobAddress used to
 * walk on the frontend).
 */
@Injectable()
export class TaskEntityResolverService {
  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Project) private readonly projectsRepo: Repository<Project>,
    @InjectRepository(Contact) private readonly contactsRepo: Repository<Contact>,
    @InjectRepository(Company) private readonly companiesRepo: Repository<Company>,
  ) {}

  /** Keyed by `${kind}:${id}` — callers look up each task's link with `resolveKey`. */
  async resolveMany(links: EntityLink[]): Promise<Map<string, TaskEntityRef>> {
    const result = new Map<string, TaskEntityRef>();

    const idsByKind: Record<TaskEntityKind, Set<number>> = {
      lead: new Set(),
      project: new Set(),
      contact: new Set(),
      company: new Set(),
    };
    for (const link of links) {
      idsByKind[link.entityKind].add(link.entityId);
    }

    const [leads, projects, contacts, companies] = await Promise.all([
      idsByKind.lead.size
        ? this.leadsRepo.find({ where: { id: In([...idsByKind.lead]) } })
        : Promise.resolve([]),
      idsByKind.project.size
        ? this.projectsRepo.find({ where: { id: In([...idsByKind.project]) }, relations: ['lead'] })
        : Promise.resolve([]),
      idsByKind.contact.size
        ? this.contactsRepo.find({ where: { id: In([...idsByKind.contact]) } })
        : Promise.resolve([]),
      idsByKind.company.size
        ? this.companiesRepo.find({ where: { id: In([...idsByKind.company]) } })
        : Promise.resolve([]),
    ]);

    for (const lead of leads) {
      result.set(resolveKey('lead', lead.id), {
        kind: 'lead',
        id: lead.id,
        label: lead.name?.trim() || `Lead #${lead.id}`,
        href: `/lead/${lead.id}`,
        leadNumber: lead.leadNumber,
        address: lead.location,
        addressLink: lead.addressLink,
        status: lead.status ?? undefined,
      });
    }

    for (const project of projects) {
      result.set(resolveKey('project', project.id), {
        kind: 'project',
        id: project.id,
        label: project.lead?.name?.trim() || `Project #${project.id}`,
        href: `/project/${project.id}`,
        leadNumber: project.lead?.leadNumber,
        address: project.lead?.location,
        addressLink: project.lead?.addressLink,
        status: project.projectProgressStatus ?? undefined,
      });
    }

    for (const contact of contacts) {
      result.set(resolveKey('contact', contact.id), {
        kind: 'contact',
        id: contact.id,
        label: contact.name?.trim() || `Contact #${contact.id}`,
        href: `/contact/${contact.id}`,
        address: contact.address,
        addressLink: contact.addressLink,
      });
    }

    for (const company of companies) {
      result.set(resolveKey('company', company.id), {
        kind: 'company',
        id: company.id,
        label: company.name?.trim() || `Company #${company.id}`,
        href: `/company/${company.id}`,
        address: company.address,
        addressLink: company.addressLink,
      });
    }

    return result;
  }
}

export function resolveKey(kind: TaskEntityKind, id: number): string {
  return `${kind}:${id}`;
}
