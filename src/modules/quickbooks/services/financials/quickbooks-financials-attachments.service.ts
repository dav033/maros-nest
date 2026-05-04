import { Injectable } from '@nestjs/common';
import { stringValue, transactionMatchesProject } from './quickbooks-financials.helpers';
import { AttachmentEntityRef } from './quickbooks-financials.types';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';

@Injectable()
export class QuickbooksFinancialsAttachmentsService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
  ) {}

  async getProjectRelatedEntityRefs(
    realmId: string,
    projectNumber: string,
    jobId: string,
    jobDisplayName?: string,
  ): Promise<AttachmentEntityRef[]> {
    const escapedJobId = this.apiService.escapeQboString(jobId);
    const [estimates, invoices, payments, purchases] = await Promise.all([
      this.apiService.queryAll(realmId, 'Estimate', {
        where: `CustomerRef IN ('${escapedJobId}')`,
      }) as Promise<Record<string, unknown>[]>,
      this.apiService.queryAll(realmId, 'Invoice', {
        where: `CustomerRef IN ('${escapedJobId}')`,
      }) as Promise<Record<string, unknown>[]>,
      this.apiService.queryAll(realmId, 'Payment', {
        where: `CustomerRef IN ('${escapedJobId}')`,
      }) as Promise<Record<string, unknown>[]>,
      this.apiService.queryAll(realmId, 'Purchase') as Promise<
        Record<string, unknown>[]
      >,
    ]);

    const projectPurchases = purchases.filter((purchase) =>
      transactionMatchesProject(
        this.normalizer.normalizePurchase(purchase),
        jobId,
        projectNumber,
        jobDisplayName,
      ),
    );

    return this.buildAttachmentEntityRefs(
      jobId,
      estimates,
      invoices,
      payments,
      projectPurchases,
    );
  }

  buildAttachmentEntityRefs(
    jobId: string,
    estimates: Array<{ Id?: unknown }>,
    invoices: Array<{ Id?: unknown }>,
    payments: Array<{ Id?: unknown }>,
    purchases: Array<{ Id?: unknown }>,
  ): AttachmentEntityRef[] {
    const refs: AttachmentEntityRef[] = [{ entityType: 'Customer', entityId: jobId }];

    for (const estimate of estimates) refs.push(this.entityRef('Estimate', estimate.Id));
    for (const invoice of invoices) refs.push(this.entityRef('Invoice', invoice.Id));
    for (const payment of payments) refs.push(this.entityRef('Payment', payment.Id));
    for (const purchase of purchases) refs.push(this.entityRef('Purchase', purchase.Id));

    return refs.filter((ref) => ref.entityId);
  }

  async getAttachablesForEntityRefs(
    realmId: string,
    refs: AttachmentEntityRef[],
  ): Promise<Record<string, unknown>[]> {
    const uniqueRefs = new Map<string, AttachmentEntityRef>();
    for (const ref of refs) {
      if (!ref.entityId || !ref.entityType) continue;
      uniqueRefs.set(`${ref.entityType}:${ref.entityId}`, ref);
    }

    const pages = await Promise.all(
      [...uniqueRefs.values()].map((ref) => {
        const entityType = this.apiService.escapeQboString(ref.entityType);
        const entityId = this.apiService.escapeQboString(ref.entityId);
        return this.apiService.queryAll(realmId, 'Attachable', {
          where:
            `AttachableRef.EntityRef.Type = '${entityType}' ` +
            `AND AttachableRef.EntityRef.Value = '${entityId}'`,
        }) as Promise<Record<string, unknown>[]>;
      }),
    );

    const byId = new Map<string, Record<string, unknown>>();
    for (const attachment of pages.flat()) {
      const id = stringValue(attachment['Id']);
      byId.set(id || `${byId.size}`, attachment);
    }
    return [...byId.values()];
  }

  groupAttachablesByEntity(
    attachables: Record<string, unknown>[],
  ): Map<string, Record<string, unknown>[]> {
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const attachment of attachables) {
      const refs = this.normalizer.normalizeAttachable(attachment).entityRefs;
      for (const ref of refs) {
        const key = `${ref.entityType}:${ref.entityId}`;
        grouped.set(key, [...(grouped.get(key) ?? []), attachment]);
      }
    }
    return grouped;
  }

  attachmentsForEntity(
    grouped: Map<string, Record<string, unknown>[]>,
    entityType: string,
    entityId: unknown,
  ): Record<string, unknown>[] {
    return grouped.get(`${entityType}:${stringValue(entityId)}`) ?? [];
  }

  private entityRef(entityType: string, entityId: unknown): AttachmentEntityRef {
    return { entityType, entityId: stringValue(entityId) };
  }
}

