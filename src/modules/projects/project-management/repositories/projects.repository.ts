import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import { leadNumberSqlFilter } from '../../../../common/utils/lead-type.utils';
import {
  applyLeadTypeScope,
  currentLeadTypeScope,
} from '../../../../common/auth/request-scope';

/** One unhydrated project row for the aging report, values as the driver returns them. */
export interface ReceivableCandidateRow {
  id: number | string;
  leadNumber: string | null;
  name: string | null;
  billedAmount: string | null;
  collectedAmount: string | null;
  billedAt: string | Date | null;
  endDate: string | Date | null;
}

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
  ) {}

  async findByProjectProgressStatus(status: ProjectProgressStatus): Promise<Project[]> {
    return this.repo.find({ where: { projectProgressStatus: status } });
  }

  /**
   * Rows GET /projects/receivables might have to show: finished work whose collection is
   * not provably closed.
   *
   * The amount test is deliberately loose — it lets through billed_amount = 0 and rows
   * where only collected_amount is missing — because what counts as settled is decided by
   * isCollectionSettled in project-billing.util, and a second copy of that rule living in
   * SQL is the kind of thing that drifts and starts hiding debt. This narrows the scan
   * (idx_projects_completed_aging); it does not judge.
   */
  /**
   * El ambito de tipos de lead del usuario. Un proyecto se filtra por el lead
   * al que pertenece, asi que la consulta tiene que traer el join con `lead`
   * antes de llamar a esto.
   */
  private scoped(qb: SelectQueryBuilder<Project>): SelectQueryBuilder<Project> {
    return applyLeadTypeScope(qb, 'lead.lead_number');
  }

  async findCompletedCollectionCandidates(): Promise<ReceivableCandidateRow[]> {
    const qb = this.repo
      .createQueryBuilder('project')
      .innerJoin('project.lead', 'lead')
      .select('project.id', 'id')
      .addSelect('lead.leadNumber', 'leadNumber')
      .addSelect('lead.name', 'name')
      .addSelect('project.billedAmount', 'billedAmount')
      .addSelect('project.collectedAmount', 'collectedAmount')
      .addSelect('project.billedAt', 'billedAt')
      .addSelect('project.endDate', 'endDate')
      .where('project.projectProgressStatus = :status', {
        status: ProjectProgressStatus.COMPLETED,
      })
      .andWhere(
        '(project.billedAmount IS NULL OR project.collectedAmount IS NULL OR project.collectedAmount < project.billedAmount)',
      )
      .orderBy('project.id', 'ASC');
    return this.scoped(qb).getRawMany<ReceivableCandidateRow>();
  }

  async getStatusCounts(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; count: number }>> {
    const qb = this.repo
      .createQueryBuilder('project')
      .select('project.projectProgressStatus', 'status')
      .addSelect('COUNT(project.id)', 'count')
      .groupBy('project.projectProgressStatus');

    // El join hace falta tanto si piden un tipo como si el usuario esta
    // restringido: sin el, el filtro del ambito apuntaria a una tabla que no
    // esta en la consulta.
    if (leadType || currentLeadTypeScope()) {
      qb.innerJoin('project.lead', 'lead');
    }
    if (leadType) {
      const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
      if (filter) {
        qb.andWhere(filter.clause, filter.parameters);
      }
    }

    const rows: Array<{ status: string | null; count: string }> =
      await this.scoped(qb).getRawMany();

    return rows.map((row) => ({
      status: row.status ?? 'UNKNOWN',
      count: Number(row.count) || 0,
    }));
  }

  async countAll(leadType?: LeadType): Promise<number> {
    // El atajo sin query builder solo vale para quien no esta restringido: con
    // un ambito puesto, `repo.count()` contaria los proyectos de todos los
    // tipos y el numero contradiria a la lista que se ensena al lado.
    if (!leadType && !currentLeadTypeScope()) {
      return this.repo.count();
    }
    const qb = this.repo
      .createQueryBuilder('project')
      .innerJoin('project.lead', 'lead');
    const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }
    return this.scoped(qb).getCount();
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

    const rows = await this.scoped(qb).getRawMany<{
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
    const qb = this.repo.createQueryBuilder('project')
      .innerJoinAndSelect('project.lead', 'lead')
      .leftJoinAndSelect('lead.contact', 'contact');
    return this.scoped(qb).getMany();
  }

  async countProjectsWithLead(): Promise<number> {
    const qb = this.repo.createQueryBuilder('project').innerJoin('project.lead', 'lead');
    return this.scoped(qb).getCount();
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
