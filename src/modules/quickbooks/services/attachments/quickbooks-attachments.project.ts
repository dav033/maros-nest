import { Logger } from '@nestjs/common';
import {
  QboAiWarning,
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
import {
  QBO_MAX_CONCURRENCY,
  runWithConcurrency,
} from '../core/quickbooks-concurrency.utils';

interface ProjectTransactionRef {
  entityType: ProjectAttachmentEntity;
  entityId: string;
  normalized?: QboNormalizedTransaction;
}

export class QuickbooksAttachmentsProjectService {
  private readonly logger = new Logger(QuickbooksAttachmentsProjectService.name);

  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly helpers: QuickbooksAttachmentsHelpers,
  ) {}

  /**
   * Devuelve tambien los avisos de las entidades que QuickBooks no pudo dar.
   * Antes las 9 consultas iban bajo un unico `Promise.all`: una entidad mala se
   * llevaba por delante los adjuntos de las otras ocho y la ficha entera salia
   * con "Could not load QuickBooks attachments". Ahora cada entidad se resuelve
   * por separado y un fallo solo pierde los adjuntos de esa entidad, con un
   * aviso que llega hasta la respuesta para que se pueda ver.
   */
  async getProjectRelatedEntityRefs(
    realmId: string,
    project: QboProjectAttachmentRef,
    params: QboProjectAttachmentsParams,
  ): Promise<{ refs: QboAttachmentEntityRef[]; warnings: QboAiWarning[] }> {
    const refs: QboAttachmentEntityRef[] = [];
    const warnings: QboAiWarning[] = [];

    /** Nunca rechaza: un fallo se convierte en aviso y en cero filas. */
    const queryEntity = async (
      entity: ProjectAttachmentEntity,
      options: Record<string, unknown>,
    ): Promise<Record<string, unknown>[]> => {
      try {
        const rows = await this.apiService.queryAll(realmId, entity, options);
        return rows.map((row) => this.helpers.asRecord(row));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`QBO ${entity} query failed for project attachments: ${message}`);
        warnings.push(
          this.normalizer.warning(
            'project_entity_query_failed',
            `QuickBooks did not return ${entity} records for this project (${message}); attachments hanging off ${entity} transactions are missing.`,
          ),
        );
        return [];
      }
    };
    const customerId =
      project.qboCustomerId || project.refs.find((ref) => ref.value)?.value;
    if (customerId) {
      refs.push({
        entityType: 'Customer',
        entityId: customerId,
        ...(project.displayName && { name: project.displayName }),
      });
    }

    const baseOptions = this.apiService.buildDateWhereClause(params);
    const customerWhere = customerId
      ? this.apiService.escapeQboString(customerId)
      : '';

    const invoiceOptions = customerId
      ? { ...baseOptions, where: this.combineWhere(baseOptions.where, `CustomerRef = '${customerWhere}'`) }
      : baseOptions;
    const estimateOptions = customerId
      ? { ...baseOptions, where: this.combineWhere(baseOptions.where, `CustomerRef = '${customerWhere}'`) }
      : baseOptions;
    const paymentOptions = customerId
      ? { ...baseOptions, where: this.combineWhere(baseOptions.where, `CustomerRef = '${customerWhere}'`) }
      : baseOptions;

    // Cada SELECT pide solo propiedades que QBO acepta proyectar para esa
    // entidad. Pedir una que no expone (Memo, CustomerRef en Bill/Purchase,
    // LinkedTxn en Bill, TotalAmt en JournalEntry...) hace que QBO rechace la
    // consulta con 400 y el proyecto se quede sin datos de QuickBooks.
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
      queryEntity('Invoice', {
        ...invoiceOptions,
        select: 'Id, DocNumber, TxnDate, DueDate, CustomerRef, TotalAmt, Balance, Line, LinkedTxn, PrivateNote, CustomerMemo',
      }),
      queryEntity('Estimate', {
        ...estimateOptions,
        select: 'Id, DocNumber, TxnDate, ExpirationDate, CustomerRef, TotalAmt, Line, LinkedTxn, PrivateNote, CustomerMemo, TxnStatus',
      }),
      queryEntity('Payment', {
        ...paymentOptions,
        select: 'Id, DocNumber, TxnDate, CustomerRef, TotalAmt, Line, LinkedTxn, PrivateNote, UnappliedAmt, DepositToAccountRef',
      }),
      queryEntity('Purchase', {
        ...baseOptions,
        select: 'Id, DocNumber, TxnDate, EntityRef, AccountRef, TotalAmt, Line, PrivateNote, PaymentType',
      }),
      queryEntity('Bill', {
        ...baseOptions,
        select: 'Id, DocNumber, TxnDate, DueDate, VendorRef, APAccountRef, TotalAmt, Balance, Line, PrivateNote',
      }),
      queryEntity('BillPayment', {
        ...baseOptions,
        select: 'Id, DocNumber, TxnDate, VendorRef, TotalAmt, Line, LinkedTxn, PrivateNote',
      }),
      queryEntity('VendorCredit', {
        ...baseOptions,
        select: 'Id, DocNumber, TxnDate, VendorRef, APAccountRef, TotalAmt, Line, PrivateNote',
      }),
      queryEntity('PurchaseOrder', {
        ...baseOptions,
        select: 'Id, DocNumber, TxnDate, VendorRef, TotalAmt, Line, PrivateNote, Memo',
      }),
      queryEntity('JournalEntry', {
        ...baseOptions,
        select: 'Id, DocNumber, TxnDate, Line, PrivateNote',
      }),
    ]);

    const projectBillIds = new Set<string>();
    const transactionRefs: ProjectTransactionRef[] = [];

    for (const raw of invoices) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Invoice',
        raw,
        this.normalizer.normalizeInvoice(raw),
        project,
      );
    }
    for (const raw of estimates) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Estimate',
        raw,
        this.normalizer.normalizeEstimate(raw),
        project,
      );
    }
    for (const raw of payments) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Payment',
        raw,
        this.normalizer.normalizePayment(raw),
        project,
      );
    }
    for (const raw of purchases) {
      this.addProjectTransactionRef(
        transactionRefs,
        'Purchase',
        raw,
        this.normalizer.normalizePurchase(raw),
        project,
      );
    }
    for (const raw of bills) {
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
    for (const raw of vendorCredits) {
      this.addProjectTransactionRef(
        transactionRefs,
        'VendorCredit',
        raw,
        this.normalizer.normalizeVendorCredit(raw),
        project,
      );
    }
    for (const raw of purchaseOrders) {
      this.addProjectTransactionRef(
        transactionRefs,
        'PurchaseOrder',
        raw,
        this.normalizer.normalizePurchaseOrder(raw),
        project,
      );
    }
    for (const raw of journalEntries) {
      this.addProjectTransactionRef(
        transactionRefs,
        'JournalEntry',
        raw,
        this.normalizer.normalizeJournalEntry(raw),
        project,
      );
    }
    for (const raw of billPayments) {
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
      const amount = ref.normalized?.totalAmount;
      refs.push({
        entityType: ref.entityType,
        entityId: ref.entityId,
        ...(typeof amount === 'number' && Number.isFinite(amount)
          ? { amount }
          : {}),
      });
    }

    return { refs: this.helpers.uniqueEntityRefs(refs), warnings };
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

    const normalizedProject = this.helpers.normalizeName(projectNumber);
    // QBO's LIKE accepts no ESCAPE clause, so `%`/`_` inside the project number
    // stay wildcards; candidates are re-checked in customerMatchesProjectNumber.
    const likePattern = `${this.apiService.escapeQboString(normalizedProject)}%`;
    const jobs = await this.queryJobsByName(realmId, likePattern);
    const match = jobs.find((customer) =>
      this.customerMatchesProjectNumber(customer, projectNumber),
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
      this.helpers.stringValue(customer['ProjectNumber']),
    ];
    return values.some((value) =>
      this.helpers.nameMatchesProject(this.helpers.normalizeName(value), normalizedProject),
    );
  }

  /**
   * QBO's query language supports neither `OR` nor grouping parentheses in the
   * WHERE clause, so each name field is queried separately and the rows merged,
   * deduplicated by Id.
   *
   * Cada campo falla por su cuenta. `runWithConcurrency` es fail-fast: el primer
   * rechazo tumbaba la promesa entera, asi que un fallo en FullyQualifiedName se
   * llevaba por delante el DisplayName que si habia respondido y el proyecto se
   * quedaba sin resolver — justo el fallo que se venia a arreglar. Solo se
   * propaga el error si NINGUNO de los dos campos respondio.
   */
  private async queryJobsByName(
    realmId: string,
    likePattern: string,
  ): Promise<QboCustomerRecord[]> {
    const fields = ['DisplayName', 'FullyQualifiedName'];
    const pages = await runWithConcurrency(
      fields.map(
        (field) => async (): Promise<QboCustomerRecord[] | Error> => {
          try {
            return (await this.apiService.queryAll(realmId, 'Customer', {
              where: `Job = true AND ${field} LIKE '${likePattern}'`,
              select: 'Id, DisplayName, FullyQualifiedName, Job',
            })) as QboCustomerRecord[];
          } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
          }
        },
      ),
      QBO_MAX_CONCURRENCY,
    );

    const failures = pages.filter((page): page is Error => page instanceof Error);
    if (failures.length === fields.length) throw failures[0];
    for (const [index, page] of pages.entries()) {
      if (page instanceof Error) {
        this.logger.warn(
          `Customer lookup by ${fields[index]} failed (${page.message}); using the other name field only.`,
        );
      }
    }

    const byId = new Map<string, QboCustomerRecord>();
    for (const page of pages) {
      if (page instanceof Error) continue;
      for (const customer of page) {
        const id = this.helpers.stringValue(customer.Id);
        byId.set(id || `${byId.size}`, customer);
      }
    }
    return [...byId.values()];
  }

  private combineWhere(existing: string | undefined, extra: string): string {
    if (!existing) return extra;
    return `${existing} AND ${extra}`;
  }
}
