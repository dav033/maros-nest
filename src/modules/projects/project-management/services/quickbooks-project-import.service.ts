import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { QboConnection } from '../../../quickbooks/entities/qbo-connection.entity';
import { QuickbooksApiService } from '../../../quickbooks/services/core/quickbooks-api.service';
import { TaskWorkspaceAssignmentService } from '../../../task-workspaces/services/task-workspace-assignment.service';

type QboJob = {
  Id?: string | number;
  DisplayName?: string;
  FullyQualifiedName?: string;
  Active?: boolean;
  Balance?: number | string;
  ParentRef?: { value?: string; name?: string };
};

export type ImportQuickbooksProjectDto = {
  qboCustomerId: string;
  projectNumber: string;
  name?: string;
  location?: string;
  leadId?: number;
  projectId?: number;
};

@Injectable()
export class QuickbooksProjectImportService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly api: QuickbooksApiService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly taskWorkspaceAssignment?: TaskWorkspaceAssignmentService,
  ) {}

  async listJobs() {
    const jobs = await this.fetchJobs();
    const [leads, projects] = await Promise.all([
      this.leadRepo.find(),
      this.projectRepo.find({ relations: ['lead'] }),
    ]);
    const projectsByLeadId = new Map<number, Project>(
      projects
        .filter((project) => project.lead)
        .map((project) => [project.lead.id, project] as const),
    );
    const projectsByQboId = new Map<string, Project>(
      projects
        .filter((project) => project.qboCustomerId)
        .map((project) => [project.qboCustomerId!, project] as const),
    );
    const leadsByProjectNumber = new Map<string, Lead[]>();
    for (const lead of leads) {
      const key = this.normalizeProjectNumber(lead.leadNumber);
      if (!key) continue;
      leadsByProjectNumber.set(key, [...(leadsByProjectNumber.get(key) ?? []), lead]);
    }

    return jobs
      .filter((job) => job.Id != null && job.DisplayName)
      .map((job) => {
        const qboCustomerId = String(job.Id);
        const displayName = String(job.DisplayName ?? '');
        const linkedProject = projectsByQboId.get(qboCustomerId);
        const projectNumber = this.projectNumberFromName(displayName);
        const matches = projectNumber
          ? (leadsByProjectNumber.get(this.normalizeProjectNumber(projectNumber)) ?? [])
              .map((lead) => {
                const project = projectsByLeadId.get(lead.id);
                return {
                  leadId: lead.id,
                  leadNumber: lead.leadNumber ?? null,
                  name: lead.name ?? null,
                  projectId: project?.id ?? null,
                  qboCustomerId: project?.qboCustomerId ?? null,
                };
              })
          : [];

        return {
          qboCustomerId,
          displayName,
          fullyQualifiedName: job.FullyQualifiedName ?? displayName,
          active: job.Active !== false,
          balance: Number(job.Balance) || 0,
          parentName: job.ParentRef?.name ?? null,
          projectNumber,
          importedProjectId: linkedProject?.id ?? null,
          matchingLeads: matches,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async importJob(dto: ImportQuickbooksProjectDto) {
    const qboCustomerId = String(dto.qboCustomerId ?? '').trim();
    const projectNumber = String(dto.projectNumber ?? '').trim();
    if (!qboCustomerId || !projectNumber) {
      throw new BadRequestException('A QuickBooks job and project number are required.');
    }
    if (projectNumber.length > 50) {
      throw new BadRequestException('Project number cannot exceed 50 characters.');
    }
    if (dto.projectId && dto.leadId) {
      throw new BadRequestException('Choose a CRM lead or project, not both.');
    }

    const job = (await this.fetchJobs()).find((candidate) => String(candidate.Id) === qboCustomerId);
    if (!job || job.Active === false) {
      throw new NotFoundException('The active QuickBooks job could not be found. Refresh the list and try again.');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const projectRepo = manager.getRepository(Project);
      const leadRepo = manager.getRepository(Lead);
      const existingLink = await projectRepo.findOne({
        where: { qboCustomerId },
        relations: ['lead'],
      });
      if (existingLink) return { project: existingLink, alreadyImported: true };

      let project: Project | null = null;
      let lead: Lead;

      if (dto.projectId) {
        project = await projectRepo.findOne({
          where: { id: dto.projectId },
          relations: ['lead'],
          lock: { mode: 'pessimistic_write' },
        });
        if (!project) throw new NotFoundException('CRM project not found.');
        if (project.qboCustomerId && project.qboCustomerId !== qboCustomerId) {
          throw new ConflictException('This project is already linked to a different QuickBooks job.');
        }
        if (!project.lead) throw new ConflictException('The selected project has no linked lead.');
        lead = project.lead;
        this.assertMatchingNumber(lead, projectNumber);
      } else if (dto.leadId) {
        const existingLead = await leadRepo.findOne({
          where: { id: dto.leadId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!existingLead) throw new NotFoundException('CRM lead not found.');
        lead = existingLead;
        this.assertMatchingNumber(lead, projectNumber);
        project = await projectRepo.findOne({
          where: { lead: { id: lead.id } },
          relations: ['lead'],
          lock: { mode: 'pessimistic_write' },
        });
        if (project?.qboCustomerId && project.qboCustomerId !== qboCustomerId) {
          throw new ConflictException('This project is already linked to a different QuickBooks job.');
        }
      } else {
        const duplicate = (await leadRepo.find()).find(
          (candidate) => this.normalizeProjectNumber(candidate.leadNumber) === this.normalizeProjectNumber(projectNumber),
        );
        if (duplicate) {
          throw new ConflictException('A CRM lead already uses this project number. Select it from the matching records instead.');
        }
        lead = leadRepo.create({
          leadNumber: projectNumber,
          name: String(dto.name || job.DisplayName || projectNumber).trim().slice(0, 100),
          location: String(dto.location ?? '').trim().slice(0, 255) || undefined,
          status: LeadStatus.WON,
          inReview: false,
        });
        lead = await leadRepo.save(lead);
      }

      if (lead.status !== LeadStatus.WON) {
        lead.status = LeadStatus.WON;
        lead = await leadRepo.save(lead);
      }

      if (!project) {
        project = projectRepo.create({
          lead,
          projectProgressStatus: ProjectProgressStatus.NOT_EXECUTED,
          quickbooks: true,
        });
      }
      project.qboCustomerId = qboCustomerId;
      project.quickbooks = true;
      const savedProject = await projectRepo.save(project);
      return { project: savedProject, alreadyImported: false };
    });

    if (!result.alreadyImported) {
      await this.taskWorkspaceAssignment?.ensureCanonicalLead(result.project.lead.id);
    }
    return {
      projectId: result.project.id,
      leadId: result.project.lead.id,
      qboCustomerId,
      alreadyImported: result.alreadyImported,
    };
  }

  private async fetchJobs(): Promise<QboJob[]> {
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new ServiceUnavailableException('QuickBooks is not connected.');
    return (await this.api.queryAll(connection.realmId, 'Customer', {
      select: 'Id, DisplayName, FullyQualifiedName, Active, Balance, ParentRef',
      where: 'Job = true AND Active = true',
      cacheKey: 'crm-project-import-jobs',
    })) as QboJob[];
  }

  private projectNumberFromName(name: string): string | null {
    const match = name.match(/^\s*\[?([0-9]{3}[A-Z]?-[0-9]{4})\]?(?:[\s,|-]*CO[\s-]*(\d+))?(?=$|[\s,|:)\]])/i);
    if (!match) return null;
    return match[2] ? `${match[1]} CO${String(Number(match[2])).padStart(2, '0')}` : match[1];
  }

  private normalizeProjectNumber(value?: string | null): string {
    const number = String(value ?? '').trim().toUpperCase().replace(/\s*-\s*/g, '-');
    const changeOrder = number.match(/^(.*?)[\s,|-]*CO[\s-]*(\d+)$/i);
    if (!changeOrder) return number;
    return `${changeOrder[1].trim()} CO${Number(changeOrder[2])}`;
  }

  private assertMatchingNumber(lead: Lead, projectNumber: string): void {
    if (this.normalizeProjectNumber(lead.leadNumber) !== this.normalizeProjectNumber(projectNumber)) {
      throw new ConflictException('The selected CRM record no longer matches this project number. Refresh the list and choose a matching record.');
    }
  }
}
