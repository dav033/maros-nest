import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { Project } from '../../../../entities/project.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { mapQboCustomersToProjects } from './quickbooks-financials.helpers';
import { JobContext, QboCustomer } from './quickbooks-financials.types';

/**
 * El indice de jobs de QuickBooks apenas cambia y es la puerta de entrada de
 * todo el enriquecimiento (financials, pagos, cronogramas). A 10s se volvia a
 * pedir entero en cada carga de pagina. Lo que si lo invalida — importar o
 * desvincular un proyecto — llama a `invalidateJobs()`.
 *
 * OJO AL DESPLEGAR: esa invalidacion es una generacion en memoria, local al
 * proceso. Solo es correcta con UNA instancia y cache en memoria. Con varias
 * instancias (o con un cache compartido tipo Redis) un import hecho en una
 * instancia no invalida a las demas, y las otras seguiran sirviendo el indice
 * viejo hasta 10 min. Para escalar a mas de una instancia hay que mover la
 * generacion al cache compartido o bajar este TTL.
 */
const JOBS_CACHE_TTL_MS = 10 * 60_000;

@Injectable()
export class QuickbooksFinancialsContextService {
  private jobsCacheGeneration = 0;

  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly apiService: QuickbooksApiService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /** Sube la generacion de la cache de jobs: importar o desvincular un
   * proyecto cambia el mapa numero-de-proyecto -> job de QBO. */
  invalidateJobs(): void {
    this.jobsCacheGeneration += 1;
  }

  /** Generacion actual del indice de jobs. Cualquier otra cache derivada del
   * indice la mete en su clave para invalidarse con el mismo `invalidateJobs()`. */
  get jobsGeneration(): number {
    return this.jobsCacheGeneration;
  }

  async resolveDefaultRealmId(): Promise<string> {
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
  }

  async resolveSingleJob(
    projectNumber: string,
    realmId: string,
  ): Promise<{ jobId: string | null; jobObject: QboCustomer | null }> {
    const ctx = await this.resolveJobs(realmId, [projectNumber]);
    return {
      jobId: ctx.jobMap[projectNumber] ?? null,
      jobObject: ctx.jobObjectMap[projectNumber] ?? null,
    };
  }

  async resolveJobs(
    realmId: string,
    projectNumbers: string[],
  ): Promise<JobContext> {
    const cacheKey = this.buildJobsCacheKey(realmId, projectNumbers);
    const cached = await this.cacheManager.get<JobContext>(cacheKey);
    if (cached) {
      return cached;
    }

    // QuickBooks job names are entered manually and do not share one delimiter
    // convention. Fetch the complete job index once, then resolve each CRM
    // number with a complete-token regex (see findQboCustomerForProject).
    const customers = (await this.apiService.queryAll(realmId, 'Customer', {
      select: 'Id, DisplayName',
      where: 'Job = true',
      cacheKey: 'project-jobs',
    })) as QboCustomer[];
    const jobMap: Record<string, string> = {};
    const jobObjectMap: Record<string, QboCustomer> = {};

    const projectMatches = mapQboCustomersToProjects(projectNumbers, customers);

    // An imported job's QBO ID is authoritative. This is what keeps a base
    // project and its CO variants financially separate even when their names
    // share the same project number.
    const linkedProjects = projectNumbers.length
      ? await this.projectRepo.find({
          where: { lead: { leadNumber: In(projectNumbers) } },
          relations: ['lead'],
        })
      : [];
    const customerById = new Map<string, QboCustomer>(
      customers.map((customer) => [String(customer.Id), customer] as const),
    );
    for (const project of linkedProjects) {
      const leadNumber = project.lead?.leadNumber;
      const customer = project.qboCustomerId
        ? customerById.get(project.qboCustomerId)
        : null;
      if (leadNumber && customer) projectMatches.set(leadNumber, customer);
    }

    for (const [projectNumber, customer] of projectMatches) {
      jobMap[projectNumber] = String(customer.Id);
      jobObjectMap[projectNumber] = customer;
    }

    const jobIds = [...new Set(Object.values(jobMap))];
    const context: JobContext = { jobMap, jobObjectMap, jobIds };
    await this.cacheManager.set(cacheKey, context, JOBS_CACHE_TTL_MS);
    return context;
  }

  private buildJobsCacheKey(realmId: string, projectNumbers: string[]): string {
    return `qbo:jobs:${this.jobsCacheGeneration}:${realmId}:${[...projectNumbers].sort().join(',')}`;
  }
}
