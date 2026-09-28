import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { createHash } from 'crypto';
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
    const projectRows = await this.leadRepo
      .createQueryBuilder('lead')
      .innerJoin('lead.project', 'project')
      .select('lead.leadNumber', 'leadNumber')
      .addSelect('project.qboCustomerId', 'qboCustomerId')
      .where('lead.leadNumber IS NOT NULL')
      .andWhere("lead.leadNumber <> ''")
      .getRawMany<{ leadNumber: string; qboCustomerId: string | null }>();

    // El indice se deriva de projects.qbo_customer_id, asi que la huella de los
    // vinculos entra en la clave: tras un import, un import-batch o un unlink la
    // clave cambia y el informe siguiente reconstruye el indice en vez de servir
    // hasta cinco minutos de cache rancia.
    const cacheKey = `qbo:job-index:${realmId}:${this.linkFingerprint(projectRows)}`;
    const cached = await this.cacheManager.get<JobIndex>(cacheKey);
    if (cached) {
      return cached;
    }

    const customers = (await this.apiService.queryAll(realmId, 'Customer', {
      where: 'Job = true',
      select: 'Id, DisplayName, FullyQualifiedName',
    })) as QboCustomer[];

    const projectNumbers = projectRows
      .map((row) => row.leadNumber)
      .filter(Boolean);
    const projectMatches = mapQboCustomersToProjects(projectNumbers, customers);

    // An imported job's QBO ID is authoritative — same rule the financials and
    // job-costing contexts already follow. A change order is named after its
    // base contract, so matching on the job name alone can report one job under
    // the other's project number.
    // Keyed on the trimmed number, the same form mapQboCustomersToProjects uses.
    // Solo cuenta el vinculo guardado si ese job sigue estando entre los
    // customers que devolvio QBO: si lo borraron o lo desactivaron alla, el
    // proyecto vuelve al match por nombre en vez de quedarse sin numero.
    const receivedCustomerIds = new Set(customers.map((c) => String(c.Id)));
    const linkedCustomerIdByNumber = new Map<string, string>();
    for (const row of projectRows) {
      if (
        row.leadNumber?.trim() &&
        row.qboCustomerId &&
        receivedCustomerIds.has(String(row.qboCustomerId))
      ) {
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

  /** Huella del estado de vinculos CRM ↔ QBO que alimenta el indice. */
  private linkFingerprint(
    rows: Array<{ leadNumber: string; qboCustomerId: string | null }>,
  ): string {
    const links = rows
      .filter((row) => row.qboCustomerId)
      .map((row) => `${row.leadNumber}=${row.qboCustomerId}`)
      .sort();
    return createHash('sha256').update(links.join('|')).digest('hex');
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
