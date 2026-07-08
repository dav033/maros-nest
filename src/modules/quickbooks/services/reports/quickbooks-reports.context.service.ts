import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
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

    const byId: JobIndex['byId'] = {};
    const projectNumberById: JobIndex['projectNumberById'] = {};

    for (const c of customers) {
      const id = String(c.Id);
      byId[id] = c;
      const displayName = String(c.DisplayName ?? '').trim();
      const prefix = displayName.split(',')[0].trim();
      projectNumberById[id] = prefix || null;
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

