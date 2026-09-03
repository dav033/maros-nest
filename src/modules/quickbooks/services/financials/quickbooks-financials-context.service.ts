import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { mapQboCustomersToProjects } from './quickbooks-financials.helpers';
import { JobContext, QboCustomer } from './quickbooks-financials.types';

const JOBS_CACHE_TTL_MS = 60 * 1000;

@Injectable()
export class QuickbooksFinancialsContextService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly apiService: QuickbooksApiService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

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
    return `qbo:jobs:${realmId}:${[...projectNumbers].sort().join(',')}`;
  }
}
