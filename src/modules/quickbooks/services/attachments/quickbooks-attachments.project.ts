import {
  QboNormalizedTransaction,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  ProjectAttachmentEntity,
  QboAttachmentEntityRef,
  QboCustomerRecord,
  QboProjectAttachmentRef,
  QboProjectAttachmentsParams,
} from './quickbooks-attachments.types';
import { QuickbooksAttachmentsHelpers } from './quickbooks-attachments.helpers';

interface ProjectTransactionRef {
  entityType: ProjectAttachmentEntity;
  entityId: string;
  normalized?: QboNormalizedTransaction;
}

export class QuickbooksAttachmentsProjectService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly helpers: QuickbooksAttachmentsHelpers,
  ) {}

  async getProjectRelatedEntityRefs(
    realmId: string,
    project: QboProjectAttachmentRef,
    params: QboProjectAttachmentsParams,
  ): Promise<QboAttachmentEntityRef[]> {
    const refs: QboAttachmentEntityRef[] = [];
    const customerId =
      project.qboCustomerId || project.refs.find((ref) => ref.value)?.value;
    if (customerId) {
      refs.push({
        entityType: 'Customer',
        entityId: customerId,
        ...(project.displayName && { name: project.displayName }),
      });
    }

    const options = this.apiService.buildDateWhereClause(params);
    const [
      invoices,
      estimates,
      payments,
      purchases,
      bills,
      billPayments,
      vendorCredits,
      purchaseOrders,
      journalEntries,
    ] = await Promise.all([
      this.apiService.queryAll(realmId, 'Invoice', options),
      this.apiService.queryAll(realmId, 'Estimate', options),
      this.apiService.queryAll(realmId, 'Payment', options),
      this.apiService.queryAll(realmId, 'Purchase', options),
      this.apiService.queryAll(realmId, 'Bill', options),
      this.apiService.queryAll(realmId, 'BillPayment', options),
      this.apiService.queryAll(realmId, 'VendorCredit', options),
      this.apiService.queryAll(realmId, 'PurchaseOrder', options),
      this.apiService.queryAll(realmId, 'JournalEntry', options),
    ]);

    const projectBillIds = new Set<string>();
    const transactionRefs: ProjectTransactionRef[] = [];

    for (const raw of invoices.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Invoice',
        raw,
        this.normalizer.normalizeInvoice(raw),
        project,
      );
    }
    for (const raw of estimates.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Estimate',
        raw,
        this.normalizer.normalizeEstimate(raw),
        project,
      );
    }
    for (const raw of payments.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Payment',
        raw,
        this.normalizer.normalizePayment(raw),
        project,
      );
    }
    for (const raw of purchases.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Purchase',
        raw,
        this.normalizer.normalizePurchase(raw),
        project,
      );
    }
    for (const raw of bills.map((row) => this.helpers.asRecord(row))) {
      const normalized = this.normalizer.normalizeBill(raw);
      const added = this.addProjectTransactionRef(
        transactionRefs,
        'Bill',
        raw,
        normalized,
        project,
      );
      if (added) projectBillIds.add(normalized.entityId);
    }
    for (const raw of vendorCredits.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'VendorCredit',
        raw,
        this.normalizer.normalizeVendorCredit(raw),
        project,
      );
    }
    for (const raw of purchaseOrders.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'PurchaseOrder',
        raw,
        this.normalizer.normalizePurchaseOrder(raw),
        project,
      );
    }
    for (const raw of journalEntries.map((row) => this.helpers.asRecord(row))) {
      this.addProjectTransactionRef(
        transactionRefs,
        'JournalEntry',
        raw,
        this.normalizer.normalizeJournalEntry(raw),
        project,
      );
    }
    for (const raw of billPayments.map((row) => this.helpers.asRecord(row))) {
      const normalized = this.normalizer.normalizeBillPayment(raw);
      const linksProjectBill = normalized.linkedTxn.some(
        (linked) => linked.txnType === 'Bill' && projectBillIds.has(linked.txnId),
      );
      if (linksProjectBill || this.transactionMatchesProject(normalized, project)) {
        transactionRefs.push({
          entityType: 'BillPayment',
          entityId: normalized.entityId || this.helpers.stringValue(raw['Id']),
          normalized,
        });
      }
    }

    for (const ref of transactionRefs) {
      if (!ref.entityId) continue;
      refs.push({
        entityType: ref.entityType,
        entityId: ref.entityId,
      });
    }

    return this.helpers.uniqueEntityRefs(refs);
  }

  async findProjectRefs(
    realmId: string,
    params: Pick<QboProjectAttachmentsParams, 'projectNumber' | 'qboCustomerId'>,
  ): Promise<QboProjectAttachmentRef> {
    const projectNumber = this.helpers.trim(params.projectNumber);
    const qboCustomerId = this.helpers.trim(params.qboCustomerId);

    if (qboCustomerId) {
      const raw = await this.apiService.getCustomer(realmId, qboCustomerId);
      const customer = this.apiService.unwrapQboEntity(raw, 'Customer');
      const displayName = this.helpers.stringValue(customer['DisplayName']);
      return {
        found: true,
        ...(projectNumber && { projectNumber }),
        qboCustomerId,
        ...(displayName && { displayName }),
        refs: [
          {
            value: qboCustomerId,
            ...(displayName && { name: displayName }),
          },
        ],
      };
    }

    if (!projectNumber) return { found: false, refs: [] };

    const jobs = (await this.apiService.queryAll(realmId, 'Customer', {
      where: 'Job = true',
    })) as QboCustomerRecord[];
    const match =
      jobs.find((customer) =>
        this.customerMatchesProjectNumber(customer, projectNumber),
      ) ??
      ((await this.apiService.queryAll(realmId, 'Customer')) as QboCustomerRecord[]).find(
        (customer) => this.customerMatchesProjectNumber(customer, projectNumber),
      );

    if (!match) {
      return {
        found: false,
        projectNumber,
        refs: [{ value: '', name: projectNumber }],
      };
    }

    const id = this.helpers.stringValue(match.Id);
    const displayName = this.helpers.stringValue(match.DisplayName);
    return {
      found: true,
      projectNumber,
      qboCustomerId: id,
      ...(displayName && { displayName }),
      refs: [
        {
          value: id,
          ...(displayName && { name: displayName }),
        },
      ],
    };
  }

  transactionMatchesProject(
    txn: QboNormalizedTransaction,
    project: QboProjectAttachmentRef,
  ): boolean {
    if (!this.helpers.hasProjectIdentity(project)) return false;
    return txn.projectRefs.some((ref) => this.helpers.projectRefMatches(ref, project));
  }

  private addProjectTransactionRef(
    refs: ProjectTransactionRef[],
    entityType: ProjectAttachmentEntity,
    raw: Record<string, unknown>,
    normalized: QboNormalizedTransaction,
    project: QboProjectAttachmentRef,
  ): boolean {
    if (!this.transactionMatchesProject(normalized, project)) return false;
    refs.push({
      entityType,
      entityId: normalized.entityId || this.helpers.stringValue(raw['Id']),
      normalized,
    });
    return true;
  }

  private customerMatchesProjectNumber(
    customer: QboCustomerRecord,
    projectNumber: string,
  ): boolean {
    const normalizedProject = this.helpers.normalizeName(projectNumber);
    const values = [
      this.helpers.stringValue(customer.Id),
      this.helpers.stringValue(customer.DisplayName),
      this.helpers.stringValue(customer.FullyQualifiedName),
      this.helpers.stringValue(customer['Name']),
      this.helpers.stringValue(customer['ProjectNumber']),
    ];
    return values.some((value) =>
      this.helpers.nameMatchesProject(this.helpers.normalizeName(value), normalizedProject),
    );
  }
}
