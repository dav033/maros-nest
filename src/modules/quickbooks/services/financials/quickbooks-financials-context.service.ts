import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { JobContext, QboCustomer, QboCustomerResponse } from './quickbooks-financials.types';

const JOBS_CACHE_TTL_MS = 5 * 60 * 1000;

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
    const direct = await this.resolveSingleJobByLike(projectNumber, realmId);
    if (direct.jobId) {
      return direct;
    }

    const ctx = await this.resolveJobs(realmId, [projectNumber]);
    return {
      jobId: ctx.jobMap[projectNumber] ?? null,
      jobObject: ctx.jobObjectMap[projectNumber] ?? null,
    };
  }

  async resolveJobs(realmId: string, projectNumbers: string[]): Promise<JobContext> {
    const cacheKey = this.buildJobsCacheKey(realmId, projectNumbers);
    const cached = await this.cacheManager.get<JobContext>(cacheKey);
    if (cached) {
      return cached;
    }

    const customerQuery =
      projectNumbers.length === 1
        ? `SELECT Id, DisplayName FROM Customer WHERE Job = true AND DisplayName LIKE '${this.apiService.escapeQboLike(projectNumbers[0])},%' ESCAPE '\\' STARTPOSITION 1 MAXRESULTS 1000`
        : 'SELECT Id, DisplayName FROM Customer WHERE Job = true STARTPOSITION 1 MAXRESULTS 1000';

    const resp = (await this.apiService.query(
      realmId,
      customerQuery,
    )) as QboCustomerResponse;

    const customers = resp?.QueryResponse?.Customer ?? [];
    const wantedSet = new Set(projectNumbers);
    const jobMap: Record<string, string> = {};
    const jobObjectMap: Record<string, QboCustomer> = {};

    for (const c of customers) {
      const dn = String(c.DisplayName ?? '').trim();
      if (!dn) continue;
      const pn = dn.split(',')[0].trim();
      if (!pn || !wantedSet.has(pn)) continue;
      jobMap[pn] = String(c.Id);
      jobObjectMap[pn] = c;
    }

    const jobIds = [...new Set(Object.values(jobMap))];
    const context: JobContext = { jobMap, jobObjectMap, jobIds };
    await this.cacheManager.set(cacheKey, context, JOBS_CACHE_TTL_MS);
    return context;
  }

  private async resolveSingleJobByLike(
    projectNumber: string,
    realmId: string,
  ): Promise<{ jobId: string | null; jobObject: QboCustomer | null }> {
    const escapedProjectNumber = this.apiService.escapeQboLike(projectNumber);
    const resp = (await this.apiService.query(
      realmId,
      `SELECT Id, DisplayName FROM Customer WHERE Job = true AND DisplayName LIKE '${escapedProjectNumber},%' ESCAPE '\\' STARTPOSITION 1 MAXRESULTS 1000`,
    )) as QboCustomerResponse;

    const customers = resp?.QueryResponse?.Customer ?? [];
    for (const c of customers) {
      const dn = String(c.DisplayName ?? '').trim();
      const pn = dn.split(',')[0].trim();
      if (pn === projectNumber) {
        return { jobId: String(c.Id), jobObject: c };
      }
    }

    return { jobId: null, jobObject: null };
  }

  private buildJobsCacheKey(realmId: string, projectNumbers: string[]): string {
    return `qbo:jobs:${realmId}:${[...projectNumbers].sort().join(',')}`;
  }
}

