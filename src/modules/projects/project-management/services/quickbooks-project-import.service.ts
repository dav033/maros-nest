import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { QboConnection } from '../../../quickbooks/entities/qbo-connection.entity';
import { QuickbooksApiService } from '../../../quickbooks/services/core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../../../quickbooks/services/financials/quickbooks-financials.service';
import { TaskWorkspaceAssignmentService } from '../../../task-workspaces/services/task-workspace-assignment.service';
import { ImportQuickbooksBatchDto } from '../dto/import-quickbooks-batch.dto';
import { ImportQuickbooksProjectDto } from '../dto/import-quickbooks-project.dto';
import {
  ProjectQboLinkAction,
  ProjectQboLinkEvent,
} from '../entities/project-qbo-link-event.entity';
import {
  diagnoseImportJobs,
  normalizeProjectNumber,
  detectChangeOrder,
  projectNumberFromName,
} from './quickbooks-import-diagnostics';

/** One screenful of decisions at a time — keeps a single transaction short. */
const MAX_BATCH_DECISIONS = 200;

type QboJob = {
  Id?: string | number;
  DisplayName?: string;
  FullyQualifiedName?: string;
  Active?: boolean;
  Balance?: number | string;
  ParentRef?: { value?: string; name?: string };
};

/**
 * `created` opened a new CRM lead + project, `linked` attached the job to a CRM
 * record that already existed, `already_imported` found the link in place.
 */
export type ImportQuickbooksOutcome = 'created' | 'linked' | 'already_imported';

export type ImportQuickbooksBatchResult = {
  qboCustomerId: string;
  projectNumber: string;
  outcome: ImportQuickbooksOutcome | 'rejected';
  projectId: number | null;
  leadId: number | null;
  reason: string | null;
  httpStatus: number | null;
};

@Injectable()
export class QuickbooksProjectImportService {
  private readonly logger = new Logger(QuickbooksProjectImportService.name);

  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly api: QuickbooksApiService,
    private readonly financials: QuickbooksFinancialsService,
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
      const key = normalizeProjectNumber(lead.leadNumber);
      if (!key) continue;
      leadsByProjectNumber.set(key, [...(leadsByProjectNumber.get(key) ?? []), lead]);
    }

    const rows = jobs
      .filter((job) => job.Id != null && job.DisplayName)
      .map((job) => {
        const qboCustomerId = String(job.Id);
        const displayName = String(job.DisplayName ?? '');
        const linkedProject = projectsByQboId.get(qboCustomerId);
        const projectNumber = projectNumberFromName(displayName);
        const matches = projectNumber
          ? (leadsByProjectNumber.get(normalizeProjectNumber(projectNumber)) ?? [])
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
      });

    // Collisions are only visible across the whole list, so diagnose in one pass.
    const diagnoses = diagnoseImportJobs(rows);

    return rows
      .map((row, index) => ({ ...row, ...diagnoses[index] }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async importJob(dto: ImportQuickbooksProjectDto) {
    const { qboCustomerId, projectNumber } = this.normalizeDecision(dto);
    const job = this.requireActiveJob(await this.fetchJobs(), qboCustomerId);

    const result = await this.dataSource.transaction((manager) =>
      this.linkJob(manager, dto, job, qboCustomerId, projectNumber),
    );

    if (result.outcome !== 'already_imported') {
      await this.taskWorkspaceAssignment?.ensureCanonicalLead(result.project.lead.id);
    }
    this.financials.invalidateJobIndex();
    // Changing a project<->job link changes what every cached QuickBooks
    // read means for this project, and the read cache now lives for five
    // minutes instead of five seconds, so purge it explicitly.
    this.api.clearReadCache();
    return {
      projectId: result.project.id,
      leadId: result.project.lead.id,
      qboCustomerId,
      outcome: result.outcome,
      alreadyImported: result.outcome === 'already_imported',
    };
  }

  /**
   * Applies many decisions inside ONE transaction, each one wrapped in its own
   * nested transaction. On Postgres a nested transaction is a SAVEPOINT, so a
   * decision that fails rolls back only its own writes: the operator keeps the
   * 39 rows that worked instead of losing the screen to one bad row, and a
   * failure still cannot leave half a link behind.
   */
  async importBatch(dto: ImportQuickbooksBatchDto) {
    const decisions = Array.isArray(dto?.decisions) ? dto.decisions : [];
    if (!decisions.length) {
      throw new BadRequestException('Provide at least one import decision.');
    }
    if (decisions.length > MAX_BATCH_DECISIONS) {
      throw new BadRequestException(
        `A batch cannot exceed ${MAX_BATCH_DECISIONS} decisions.`,
      );
    }

    const jobs = await this.fetchJobs();
    const touchedLeadIds: number[] = [];

    const results = await this.dataSource.transaction(async (manager) => {
      const applied: ImportQuickbooksBatchResult[] = [];
      for (const decision of decisions) {
        try {
          const { qboCustomerId, projectNumber } = this.normalizeDecision(decision);
          const job = this.requireActiveJob(jobs, qboCustomerId);
          const result = await manager.transaction((savepoint) =>
            this.linkJob(savepoint, decision, job, qboCustomerId, projectNumber),
          );
          if (result.outcome !== 'already_imported') {
            touchedLeadIds.push(result.project.lead.id);
          }
          applied.push({
            qboCustomerId,
            projectNumber,
            outcome: result.outcome,
            projectId: result.project.id,
            leadId: result.project.lead.id,
            reason: null,
            httpStatus: null,
          });
        } catch (error) {
          applied.push({
            qboCustomerId: String(decision?.qboCustomerId ?? '').trim(),
            projectNumber: String(decision?.projectNumber ?? '').trim(),
            outcome: 'rejected',
            projectId: null,
            leadId: null,
            ...this.describeFailure(error),
          });
        }
      }
      return applied;
    });

    this.financials.invalidateJobIndex();
    // Changing a project<->job link changes what every cached QuickBooks
    // read means for this project, and the read cache now lives for five
    // minutes instead of five seconds, so purge it explicitly.
    this.api.clearReadCache();

    // After commit: a task-workspace hiccup must not discard accepted decisions.
    for (const leadId of touchedLeadIds) {
      try {
        await this.taskWorkspaceAssignment?.ensureCanonicalLead(leadId);
      } catch (error) {
        this.logger.warn(
          `Task workspace for lead ${leadId} could not be ensured after batch import: ${String(error)}`,
        );
      }
    }

    return {
      total: results.length,
      created: results.filter((result) => result.outcome === 'created').length,
      linked: results.filter((result) => result.outcome === 'linked').length,
      alreadyImported: results.filter((result) => result.outcome === 'already_imported').length,
      rejected: results.filter((result) => result.outcome === 'rejected').length,
      results,
    };
  }

  /**
   * Enlaza a mano un proyecto del CRM que YA existe con un job de QuickBooks.
   * Es el contrario de `unlinkProject` y el complemento de la importacion: la
   * importacion parte del job (y crea o busca el proyecto), esto parte del
   * proyecto abierto en pantalla y le dice cual es su job.
   *
   * A diferencia de `linkJob` aqui NO se exige que el nombre del job lleve el
   * numero de proyecto: ese requisito es justo lo que deja fuera de la
   * importacion a los jobs "sin numero", que son los que hay que enlazar a
   * mano. La coincidencia se informa en `projectNumberMatchesJob` para que la
   * pantalla pueda avisar, pero no bloquea.
   *
   * Si el proyecto ya apuntaba a otro job se reemplaza el vinculo — es una
   * correccion explicita pedida desde la ficha — y queda en la bitacora con el
   * id anterior. Lo que si es un 409 es robarle el job a otro proyecto: el
   * indice unico parcial lo impide de todos modos, y el mensaje explica cual.
   */
  async linkProject(
    projectId: number,
    rawQboCustomerId: string,
    actorEmail?: string | null,
  ) {
    const qboCustomerId = String(rawQboCustomerId ?? '').trim();
    if (!qboCustomerId) {
      throw new BadRequestException('A QuickBooks job is required.');
    }
    if (qboCustomerId.length > 50) {
      throw new BadRequestException('QuickBooks job id cannot exceed 50 characters.');
    }

    const job = this.requireActiveJob(await this.fetchJobs(), qboCustomerId);
    const jobDisplayName = String(job.DisplayName ?? '');

    const result = await this.dataSource.transaction(async (manager) => {
      const projectRepo = manager.getRepository(Project);
      const project = await this.lockProject(manager, { id: projectId });
      if (!project) throw new NotFoundException('CRM project not found.');

      const previousQboCustomerId = project.qboCustomerId ?? null;
      if (previousQboCustomerId === qboCustomerId) {
        return { project, previousQboCustomerId, changed: false };
      }

      const owner = await projectRepo.findOne({
        where: { qboCustomerId },
        relations: ['lead'],
      });
      if (owner && owner.id !== project.id) {
        const ownerNumber = owner.lead?.leadNumber ? ` (${owner.lead.leadNumber})` : '';
        throw new ConflictException(
          `This QuickBooks job is already linked to project #${owner.id}${ownerNumber}. Unlink it there first.`,
        );
      }

      project.qboCustomerId = qboCustomerId;
      project.quickbooks = true;
      const saved = await projectRepo.save(project);
      await this.recordLinkEvent(manager, {
        action: 'link',
        projectId: saved.id,
        previousQboCustomerId,
        newQboCustomerId: qboCustomerId,
        projectNumber: saved.lead?.leadNumber ?? null,
        jobDisplayName,
        actorEmail: actorEmail ?? null,
      });
      return { project: saved, previousQboCustomerId, changed: true };
    });

    const projectNumber = result.project.lead?.leadNumber ?? null;
    if (result.changed) {
      const replaced = result.previousQboCustomerId
        ? `, replacing job ${result.previousQboCustomerId}`
        : '';
      const by = actorEmail ? ` by ${actorEmail}` : '';
      this.logger.log(
        `QuickBooks link set for project ${result.project.id} (lead number ${projectNumber ?? '(none)'}) to job ${qboCustomerId} "${jobDisplayName}"${replaced}${by}`,
      );
      this.financials.invalidateJobIndex();
      // Changing a project<->job link changes what every cached QuickBooks
      // read means for this project, and the read cache now lives for five
      // minutes instead of five seconds, so purge it explicitly.
      this.api.clearReadCache();
    }

    const nameNumber = projectNumberFromName(jobDisplayName);
    return {
      projectId: result.project.id,
      leadId: result.project.lead?.id ?? null,
      projectNumber,
      qboCustomerId,
      jobDisplayName,
      previousQboCustomerId: result.previousQboCustomerId,
      linked: result.changed,
      alreadyLinked: !result.changed,
      projectNumberMatchesJob:
        !!projectNumber &&
        !!nameNumber &&
        normalizeProjectNumber(nameNumber) === normalizeProjectNumber(projectNumber),
    };
  }

  /**
   * Breaks the QuickBooks link so a mislinked job can be fixed from the UI
   * instead of by hand in SQL. The lead and the project stay exactly as they
   * are — only `qbo_customer_id` and `quickbooks` are cleared, which frees the
   * partial unique index for the job that should have been linked.
   */
  async unlinkProject(projectId: number, actorEmail?: string | null) {
    const result = await this.dataSource.transaction(async (manager) => {
      const projectRepo = manager.getRepository(Project);
      const project = await this.lockProject(manager, { id: projectId });
      if (!project) throw new NotFoundException('CRM project not found.');

      const previousQboCustomerId = project.qboCustomerId ?? null;
      if (!previousQboCustomerId) return { project, previousQboCustomerId };

      project.qboCustomerId = null;
      project.quickbooks = false;
      const saved = await projectRepo.save(project);
      await this.recordLinkEvent(manager, {
        action: 'unlink',
        projectId: saved.id,
        previousQboCustomerId,
        newQboCustomerId: null,
        projectNumber: saved.lead?.leadNumber ?? null,
        jobDisplayName: null,
        actorEmail: actorEmail ?? null,
      });
      return { project: saved, previousQboCustomerId };
    });

    // Romper un vinculo no deja rastro en ninguna tabla: el log es lo unico que
    // permite reconstruir despues que job estaba enganchado a que proyecto.
    if (result.previousQboCustomerId) {
      this.logger.log(
        `QuickBooks link cleared for project ${result.project.id} (lead number ${result.project.lead?.leadNumber ?? '(none)'}), previous QuickBooks job ${result.previousQboCustomerId}`,
      );
    }

    this.financials.invalidateJobIndex();
    // Changing a project<->job link changes what every cached QuickBooks
    // read means for this project, and the read cache now lives for five
    // minutes instead of five seconds, so purge it explicitly.
    this.api.clearReadCache();
    return {
      projectId: result.project.id,
      leadId: result.project.lead?.id ?? null,
      previousQboCustomerId: result.previousQboCustomerId,
      unlinked: result.previousQboCustomerId != null,
    };
  }

  /** Una fila de bitacora por cada cambio de vinculo, dentro de la misma
   * transaccion que el cambio: o quedan las dos cosas o no queda ninguna. */
  private async recordLinkEvent(
    manager: EntityManager,
    event: {
      action: ProjectQboLinkAction;
      projectId: number;
      previousQboCustomerId: string | null;
      newQboCustomerId: string | null;
      projectNumber: string | null;
      jobDisplayName: string | null;
      actorEmail: string | null;
    },
  ): Promise<void> {
    const repo = manager.getRepository(ProjectQboLinkEvent);
    await repo.save(
      repo.create({
        projectId: event.projectId,
        action: event.action,
        previousQboCustomerId: event.previousQboCustomerId,
        newQboCustomerId: event.newQboCustomerId,
        projectNumber: event.projectNumber?.slice(0, 50) ?? null,
        jobDisplayName: event.jobDisplayName?.slice(0, 255) ?? null,
        actorEmail: event.actorEmail?.slice(0, 255) ?? null,
      }),
    );
  }

  /**
   * Postgres rechaza `FOR UPDATE` sobre el lado nullable de un outer join, y las
   * `relations` de TypeORM siempre generan un LEFT JOIN: bloquear y unir en la misma
   * consulta revienta en tiempo de ejecucion. Se bloquea la fila sola y luego se lee
   * con sus relaciones, ya dentro de la misma transaccion.
   */
  private async lockProject(
    manager: EntityManager,
    where: FindOptionsWhere<Project>,
  ): Promise<Project | null> {
    const repo = manager.getRepository(Project);
    const locked = await repo.findOne({
      where,
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) return null;
    return repo.findOne({ where: { id: locked.id }, relations: ['lead'] });
  }

  private async linkJob(
    manager: EntityManager,
    dto: ImportQuickbooksProjectDto,
    job: QboJob,
    qboCustomerId: string,
    projectNumber: string,
  ): Promise<{ project: Project; outcome: ImportQuickbooksOutcome }> {
    const projectRepo = manager.getRepository(Project);
    const leadRepo = manager.getRepository(Lead);
    const existingLink = await projectRepo.findOne({
      where: { qboCustomerId },
      relations: ['lead'],
    });
    if (existingLink) {
      // Una decision que apuntaba a OTRO destino no puede contestarse con este:
      // devolver 'already_imported' del proyecto de otro esconde un conflicto real.
      const aimedElsewhere =
        (dto.projectId != null && dto.projectId !== existingLink.id) ||
        (dto.leadId != null && dto.leadId !== existingLink.lead?.id);
      if (aimedElsewhere) {
        throw new ConflictException(
          'This QuickBooks job is already linked to a different CRM project.',
        );
      }
      return { project: existingLink, outcome: 'already_imported' };
    }

    // El diagnostico de GET .../jobs es solo de lectura: sin esta guarda, el camino de
    // escritura crearia alegremente la colision que la pantalla acaba de avisar. Es el
    // caso 283/387: la orden de cambio no puede quedarse con el numero del contrato base.
    const jobMarker = detectChangeOrder(String(job.DisplayName ?? ''));
    if (jobMarker.isChangeOrder && !detectChangeOrder(projectNumber).isChangeOrder) {
      const suggestion = jobMarker.suggestedProjectNumber
        ? ` Use "${jobMarker.suggestedProjectNumber}" instead.`
        : '';
      throw new ConflictException(
        `This QuickBooks job is a change order and cannot take the base contract number "${projectNumber}".${suggestion}`,
      );
    }

    let project: Project | null = null;
    let lead: Lead;
    let createdLead = false;

    if (dto.projectId) {
      project = await this.lockProject(manager, { id: dto.projectId });
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
      project = await this.lockProject(manager, { lead: { id: lead.id } });
      if (project?.qboCustomerId && project.qboCustomerId !== qboCustomerId) {
        throw new ConflictException('This project is already linked to a different QuickBooks job.');
      }
    } else {
      // Solo las filas que empiezan por el mismo bloque inicial, no la tabla
      // entera una vez por decision: normalizeProjectNumber solo cambia
      // mayusculas, espacios y el sufijo CO, asi que un duplicado real comparte
      // ese prefijo, que es el que cubre el indice de lead_number.
      const key = normalizeProjectNumber(projectNumber);
      const candidates = await leadRepo.find({
        where: { leadNumber: ILike(`${key.split(/[\s-]/)[0]}%`) },
      });
      const duplicate = candidates.find(
        (candidate) => normalizeProjectNumber(candidate.leadNumber) === key,
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
      createdLead = true;
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
    return { project: savedProject, outcome: createdLead ? 'created' : 'linked' };
  }

  private normalizeDecision(dto: ImportQuickbooksProjectDto): {
    qboCustomerId: string;
    projectNumber: string;
  } {
    const qboCustomerId = String(dto?.qboCustomerId ?? '').trim();
    const projectNumber = String(dto?.projectNumber ?? '').trim();
    if (!qboCustomerId || !projectNumber) {
      throw new BadRequestException('A QuickBooks job and project number are required.');
    }
    if (projectNumber.length > 50) {
      throw new BadRequestException('Project number cannot exceed 50 characters.');
    }
    if (dto.projectId && dto.leadId) {
      throw new BadRequestException('Choose a CRM lead or project, not both.');
    }
    return { qboCustomerId, projectNumber };
  }

  private requireActiveJob(jobs: QboJob[], qboCustomerId: string): QboJob {
    const job = jobs.find((candidate) => String(candidate.Id) === qboCustomerId);
    if (!job || job.Active === false) {
      throw new NotFoundException('The active QuickBooks job could not be found. Refresh the list and try again.');
    }
    return job;
  }

  private describeFailure(error: unknown): {
    reason: string;
    httpStatus: number | null;
  } {
    if (error instanceof HttpException) {
      return { reason: error.message, httpStatus: error.getStatus() };
    }
    return {
      reason: error instanceof Error ? error.message : 'Unexpected error.',
      httpStatus: null,
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

  private assertMatchingNumber(lead: Lead, projectNumber: string): void {
    if (normalizeProjectNumber(lead.leadNumber) !== normalizeProjectNumber(projectNumber)) {
      throw new ConflictException('The selected CRM record no longer matches this project number. Refresh the list and choose a matching record.');
    }
  }
}
