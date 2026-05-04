import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  JobIndex,
  QboCustomerResponse,
  QboEstimate,
  QboInvoice,
} from './quickbooks-reports.types';

@Injectable()
export class QuickbooksReportsContextService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly apiService: QuickbooksApiService,
  ) {}

  async resolveRealmId(realmId?: string): Promise<string> {
    if (realmId) return realmId;
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
  }

  async buildJobIndex(realmId: string): Promise<JobIndex> {
    const resp = (await this.apiService.query(
      realmId,
      `SELECT * FROM Customer WHERE Job = true STARTPOSITION 1 MAXRESULTS 1000`,
    )) as QboCustomerResponse;

    const customers = resp?.QueryResponse?.Customer ?? [];
    const byId: JobIndex['byId'] = {};
    const projectNumberById: JobIndex['projectNumberById'] = {};

    for (const c of customers) {
      const id = String(c.Id);
      byId[id] = c;
      const displayName = String(c.DisplayName ?? '').trim();
      const prefix = displayName.split(',')[0].trim();
      projectNumberById[id] = prefix || null;
    }

    return { byId, projectNumberById };
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

