import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { JobContext, QboCustomer, QboCustomerResponse } from './quickbooks-financials.types';

@Injectable()
export class QuickbooksFinancialsContextService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly apiService: QuickbooksApiService,
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

  async resolveJobs(realmId: string, projectNumbers: string[]): Promise<JobContext> {
    const customerQuery =
      projectNumbers.length === 1
        ? `SELECT * FROM Customer WHERE Job = true AND DisplayName LIKE '${projectNumbers[0].replace(/'/g, "''")},%' STARTPOSITION 1 MAXRESULTS 1000`
        : 'SELECT * FROM Customer WHERE Job = true STARTPOSITION 1 MAXRESULTS 1000';

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
    return { jobMap, jobObjectMap, jobIds };
  }
}

