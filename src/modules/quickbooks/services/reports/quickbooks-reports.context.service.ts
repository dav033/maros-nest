import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { Lead } from '../../../../entities/lead.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { mapQboCustomersToProjects } from '../financials/quickbooks-financials.helpers';
import {
  JobIndex,
  QboCustomer,
  QboEstimate,
  QboInvoice,
} from './quickbooks-reports.types';

const JOB_INDEX_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class QuickbooksReportsContextService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    private readonly apiService: QuickbooksApiService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async resolveRealmId(realmId?: string): Promise<string> {
    if (realmId) return realmId;
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
  }

  async buildJobIndex(realmId: string): Promise<JobIndex> {
    const cacheKey = `qbo:job-index:${realmId}`;
    const cached = await this.cacheManager.get<JobIndex>(cacheKey);
    if (cached) {
      return cached;
    }

    const customers = (await this.apiService.queryAll(realmId, 'Customer', {
      where: 'Job = true',
      select: 'Id, DisplayName, FullyQualifiedName',
    })) as QboCustomer[];

    const projectRows = await this.leadRepo
      .createQueryBuilder('lead')
      .innerJoin('lead.project', 'project')
      .select('lead.leadNumber', 'leadNumber')
      .addSelect('project.qboCustomerId', 'qboCustomerId')
      .where('lead.leadNumber IS NOT NULL')
      .andWhere("lead.leadNumber <> ''")
      .getRawMany<{ leadNumber: string; qboCustomerId: string | null }>();
    const projectNumbers = projectRows
      .map((row) => row.leadNumber)
      .filter(Boolean);
    const projectMatches = mapQboCustomersToProjects(projectNumbers, customers);

    // An imported job's QBO ID is authoritative — same rule the financials and
    // job-costing contexts already follow. A change order is named after its
    // base contract, so matching on the job name alone can report one job under
    // the other's project number.
    // Keyed on the trimmed number, the same form mapQboCustomersToProjects uses.
    const linkedCustomerIdByNumber = new Map<string, string>();
    for (const row of projectRows) {
      if (row.leadNumber?.trim() && row.qboCustomerId) {
        linkedCustomerIdByNumber.set(row.leadNumber.trim(), String(row.qboCustomerId));
      }
    }
    const projectNumberByCustomerId = new Map<string, string>();
    for (const [projectNumber, customer] of projectMatches) {
      // Skip the name-derived guess: the stored link below replaces it.
      if (linkedCustomerIdByNumber.has(projectNumber)) continue;
      projectNumberByCustomerId.set(String(customer.Id), projectNumber);
    }
    for (const [projectNumber, customerId] of linkedCustomerIdByNumber) {
      projectNumberByCustomerId.set(customerId, projectNumber);
    }

    const byId: JobIndex['byId'] = {};
    const projectNumberById: JobIndex['projectNumberById'] = {};

    for (const c of customers) {
      const id = String(c.Id);
      byId[id] = c;
      projectNumberById[id] = projectNumberByCustomerId.get(id) ?? null;
    }

    const index: JobIndex = { byId, projectNumberById };
    await this.cacheManager.set(cacheKey, index, JOB_INDEX_TTL_MS);
    return index;
  }

  refId(ref: QboInvoice['CustomerRef'] | QboEstimate['CustomerRef']): string {
    if (!ref) return '';
    if (typeof ref === 'object' && 'value' in ref) return String(ref.value);
    return String(ref);
  }

  refName(ref: QboInvoice['CustomerRef']): string {
    if (!ref) return '';
    if (typeof ref === 'object' && 'name' in ref) return String(ref.name ?? '');
    return '';
  }
}
