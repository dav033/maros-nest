import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import { leadNumberSqlFilter } from '../../../../common/utils/lead-type.utils';

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
  ) {}

  async findByProjectProgressStatus(status: ProjectProgressStatus): Promise<Project[]> {
    return this.repo.find({ where: { projectProgressStatus: status } });
  }

  async getStatusCounts(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; count: number }>> {
    const qb = this.repo
      .createQueryBuilder('project')
      .select('project.projectProgressStatus', 'status')
      .addSelect('COUNT(project.id)', 'count')
      .groupBy('project.projectProgressStatus');

    if (leadType) {
      qb.innerJoin('project.lead', 'lead');
      const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
      if (filter) {
        qb.andWhere(filter.clause, filter.parameters);
      }
    }

    const rows: Array<{ status: string | null; count: string }> = await qb.getRawMany();

    return rows.map((row) => ({
      status: row.status ?? 'UNKNOWN',
      count: Number(row.count) || 0,
    }));
  }

  async countAll(leadType?: LeadType): Promise<number> {
    if (!leadType) {
      return this.repo.count();
    }
    const qb = this.repo
      .createQueryBuilder('project')
      .innerJoin('project.lead', 'lead');
    const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }
    return qb.getCount();
  }

  async findAnalyticsProjectSeed(
    limit: number = 200,
    leadType?: LeadType,
  ): Promise<
    Array<{
      id: number;
      projectProgressStatus?: ProjectProgressStatus;
      leadNumber?: string;
      leadName?: string;
    }>
  > {
    const safeLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const qb = this.repo
      .createQueryBuilder('project')
      .innerJoin('project.lead', 'lead')
      .select('project.id', 'id')
      .addSelect('project.projectProgressStatus', 'projectProgressStatus')
      .addSelect('lead.leadNumber', 'leadNumber')
      .addSelect('lead.name', 'leadName')
      .where('lead.leadNumber IS NOT NULL')
      .orderBy('project.id', 'DESC')
      .limit(safeLimit);

    const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }

    const rows = await qb.getRawMany<{
      id: number | string;
      projectProgressStatus?: string | null;
      leadNumber?: string | null;
      leadName?: string | null;
    }>();

    return rows.map((row) => {
      const status = row.projectProgressStatus;
      const normalizedStatus =
        status &&
        Object.values(ProjectProgressStatus).includes(
          status as ProjectProgressStatus,
        )
          ? (status as ProjectProgressStatus)
          : undefined;

      return {
        id: Number(row.id) || 0,
        projectProgressStatus: normalizedStatus,
        leadNumber: row.leadNumber ?? undefined,
        leadName: row.leadName ?? undefined,
      };
    });
  }

  async findProjectsWithLeadAndContact(): Promise<Project[]> {
    return this.repo.createQueryBuilder('project')
      .innerJoinAndSelect('project.lead', 'lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .getMany();
  }

  async countProjectsWithLead(): Promise<number> {
    return this.repo.createQueryBuilder('project')
      .innerJoin('project.lead', 'lead')
      .getCount();
  }

  async findByLeadId(leadId: number): Promise<Project[]> {
    return this.repo.find({ where: { lead: { id: leadId } } });
  }

  async findByLeadNumber(leadNumber: string): Promise<Project | null> {
    return this.repo.findOne({ 
      where: { lead: { leadNumber } },
      relations: ['lead', 'lead.contact', 'lead.projectType', 'lead.contact.company']
    });
  }

  async save(project: Project): Promise<Project> {
    return this.repo.save(project);
  }

  async findOne(id: number): Promise<Project | null> {
    return this.repo.findOne({ where: { id } });
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
