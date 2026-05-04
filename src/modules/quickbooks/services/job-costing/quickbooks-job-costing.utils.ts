import {
  QboAiWarning,
  QboNormalizedLine,
  QboNormalizedTransaction,
  QboRef,
} from '../core/quickbooks-normalizer.service';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import {
  asRecord,
  asRecordArray,
  money,
  normalizeName,
  numberValue,
  stringValue,
  trim,
} from '../core/qbo-value.utils';
import { resolveRealmIdOrDefault } from '../core/quickbooks-realm.utils';
import {
  ProjectAllocation,
  QboJobCostingParams,
  QboJobCostTransaction,
  QboProjectCashOutResult,
  QboResolvedProjectRef,
  QboCustomerRecord,
} from './quickbooks-job-costing.types';

export class QuickbooksJobCostingUtils {
  constructor(
    protected readonly apiService: QuickbooksApiService,
    protected readonly financials: QuickbooksFinancialsService,
  ) {}

  protected async findCustomersForProjectNumber(
    realmId: string,
    projectNumber: string,
  ): Promise<Record<string, unknown>[]> {
    const jobs = (await this.apiService.queryAll(realmId, 'Customer', {
      where: 'Job = true',
    })) as QboCustomerRecord[];
    const jobMatches = jobs.filter((customer) =>
      this.customerMatchesProjectNumber(customer, projectNumber),
    );
    if (jobMatches.length)
      return jobMatches.map((customer) => ({ ...customer }));

    const customers = (await this.apiService.queryAll(
      realmId,
      'Customer',
    )) as QboCustomerRecord[];
    return customers
      .filter((customer) =>
        this.customerMatchesProjectNumber(customer, projectNumber),
      )
      .map((customer) => ({ ...customer }));
  }

  protected customerMatchesProjectNumber(
    customer: QboCustomerRecord,
    projectNumber: string,
  ): boolean {
    const normalizedProject = this.normalizeName(projectNumber);
    if (!normalizedProject) return false;
    const values = [
      this.stringValue(customer.Id),
      this.stringValue(customer.DisplayName),
      this.stringValue(customer.FullyQualifiedName),
      this.stringValue(customer['Name']),
      this.stringValue(customer['ProjectNumber']),
    ];
    return values.some((value) =>
      this.nameMatchesProject(this.normalizeName(value), normalizedProject),
    );
  }

  protected nameMatchesProject(value: string, project: string): boolean {
    if (!value || !project) return false;
    if (value === project) return true;
    if (value.startsWith(`${project},`)) return true;
    const parts = value
      .split(/[:,]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.includes(project);
  }

  protected async fetchCustomerById(
    realmId: string,
    customerId: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.apiService.getCustomer(realmId, customerId);
    return this.apiService.unwrapQboEntity(raw, 'Customer');
  }

  protected vendorMatches(
    txn: QboNormalizedTransaction,
    params: QboJobCostingParams,
  ): boolean {
    const vendorId = this.trim(params.vendorId);
    const vendorName = this.normalizeName(params.vendorName);
    if (!vendorId && !vendorName) return true;
    const ref = txn.vendor;
    if (!ref) return false;
    if (vendorId && ref.value === vendorId) return true;
    if (!vendorName) return false;
    const txnName = this.normalizeName(ref.name ?? ref.value);
    return txnName === vendorName || txnName.includes(vendorName);
  }

  protected transactionMatchesProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
  ): boolean {
    if (!project || !this.hasProjectIdentity(project)) return false;
    return txn.projectRefs.some((ref) => this.projectRefMatches(ref, project));
  }

  protected lineMatchesProject(
    line: QboNormalizedLine,
    project: QboResolvedProjectRef,
  ): boolean {
    return line.projectRefs.some((ref) => this.projectRefMatches(ref, project));
  }

  protected projectRefMatches(
    ref: QboRef,
    project: QboResolvedProjectRef,
  ): boolean {
    const idSet = new Set(
      project.refs.map((projectRef) => projectRef.value).filter(Boolean),
    );
    if (ref.value && idSet.has(ref.value)) return true;

    const nameCandidates = [
      project.projectNumber,
      project.displayName,
      ...project.refs.map((projectRef) => projectRef.name),
    ]
      .map((value) => this.normalizeName(value))
      .filter(Boolean);
    const refName = this.normalizeName(ref.name);
    if (!refName) return false;

    return nameCandidates.some((candidate) =>
      this.nameMatchesProject(refName, candidate),
    );
  }

  protected hasProjectIdentity(project: QboResolvedProjectRef): boolean {
    return project.refs.some((ref) => ref.value || ref.name);
  }

  protected shouldIncludeAllocation(
    allocation: ProjectAllocation,
    requireProjectMatch: boolean,
  ): boolean {
    if (!requireProjectMatch) return allocation.amount !== 0;
    return allocation.amount !== 0 && allocation.method !== 'no_project_match';
  }

  protected lineUsesExplicitCostAccount(line: QboNormalizedLine): boolean {
    const accountName = this.normalizeName(
      line.account?.name ?? line.category?.name ?? '',
    );
    return (
      accountName.includes('expense') ||
      accountName.includes('cost of goods') ||
      accountName.includes('cogs') ||
      accountName.includes('job cost') ||
      accountName.includes('materials') ||
      accountName.includes('material') ||
      accountName.includes('subcontract') ||
      accountName.includes('labor') ||
      accountName.includes('labour')
    );
  }

  protected isPaidPurchase(raw: Record<string, unknown>): boolean {
    const paymentType = this.stringValue(raw['PaymentType']).toLowerCase();
    return ['check', 'creditcard', 'cash'].includes(paymentType);
  }

  protected isClosedPurchaseOrder(txn: QboNormalizedTransaction): boolean {
    return this.normalizeName(txn.status) === 'closed';
  }

  protected fullAllocation(amount: number, method: string): ProjectAllocation {
    const rounded = this.money(amount);
    return {
      amount: rounded,
      basisAmount: rounded,
      ratio: rounded === 0 ? 0 : 1,
      method,
      details: [
        {
          basisAmount: rounded,
          projectBasisAmount: rounded,
          allocatedAmount: rounded,
          allocationRatio: rounded === 0 ? 0 : 1,
          allocationMethod: method,
        },
      ],
    };
  }

  protected emptyAllocation(method: string): ProjectAllocation {
    return {
      amount: 0,
      basisAmount: 0,
      ratio: 0,
      method,
      details: [],
    };
  }

  protected lineBasisAmount(
    lines: QboNormalizedLine[],
    fallbackAmount: number,
  ): number {
    const lineSum = lines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
    return this.money(lineSum || Math.abs(fallbackAmount));
  }

  protected ratio(amount: number, basis: number): number {
    if (!basis) return 0;
    return Math.max(0, Math.min(1, Math.abs(amount) / Math.abs(basis)));
  }

  protected firstLineCategory(txn: QboJobCostTransaction): QboRef | undefined {
    const line = txn.lineItems.find((item) => item.category ?? item.account);
    return line?.category ?? line?.account;
  }

  protected extractLinkedTxnFromRaw(
    raw: Record<string, unknown>,
  ): Array<{ txnId: string; txnType: string }> {
    return [
      ...this.extractLinkedTxnList(raw['LinkedTxn']),
      ...this.asArray(raw['Line']).flatMap((line) =>
        this.extractLinkedTxnList(line['LinkedTxn']),
      ),
    ];
  }

  protected extractLinkedTxnList(
    raw: unknown,
  ): Array<{ txnId: string; txnType: string }> {
    return this.asArray(raw).map((linked) => ({
      txnId: this.stringValue(linked['TxnId']),
      txnType: this.stringValue(linked['TxnType']),
    }));
  }

  protected entityKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  protected projectCustomerId(project: QboResolvedProjectRef): string {
    return (
      project.qboCustomerId ||
      project.refs.find((ref) => this.trim(ref.value))?.value ||
      ''
    );
  }

  protected buildWhereOptions(...parts: Array<string | undefined>): {
    where?: string;
  } {
    const where = parts
      .map((part) => this.trim(part))
      .filter(Boolean)
      .join(' AND ');
    return where ? { where } : {};
  }

  protected isAcceptedEstimate(txn: QboNormalizedTransaction): boolean {
    return this.normalizeName(txn.status) === 'accepted';
  }

  protected hasLineWithoutProjectRef(
    txn: QboNormalizedTransaction | QboJobCostTransaction,
  ): boolean {
    if (txn.lineItems.length === 0) return false;
    return txn.lineItems.some((line) => line.projectRefs.length === 0);
  }

  protected isProportionalBillPaymentAllocation(
    txn: QboJobCostTransaction,
  ): boolean {
    if (txn.entityType !== 'BillPayment') return false;
    if (txn.allocationRatio > 0 && txn.allocationRatio < 1) return true;
    if (txn.allocationMethod.includes('ratio')) return true;
    return txn.allocationDetails.some(
      (detail) =>
        (detail.allocationRatio > 0 && detail.allocationRatio < 1) ||
        detail.allocationMethod.includes('ratio'),
    );
  }

  protected uniqueStrings(values: string[]): string[] {
    const unique = new Set<string>();
    for (const value of values) {
      const normalized = this.trim(value);
      if (normalized) unique.add(normalized);
    }
    return [...unique];
  }

  protected emptyProjectResult(
    project: QboResolvedProjectRef,
    params: QboJobCostingParams,
    warnings: QboAiWarning[],
  ): QboProjectCashOutResult {
    return {
      project,
      summary: {
        cashOutPaid: 0,
        openAp: 0,
        committedPo: 0,
        vendorCredits: 0,
        adjustedCosts: 0,
        totalJobCost: 0,
      },
      transactions: [],
      vendorBreakdown: [],
      categoryBreakdown: [],
      warnings,
      coverage: {
        entitiesQueried: [],
        dateRange: {
          startDate: params.startDate ?? null,
          endDate: params.endDate ?? null,
        },
        paginationComplete: true,
        attachmentCoverage: {
          requested: params.includeAttachments ?? true,
          entitiesChecked: 0,
          attachmentsFound: 0,
          fallbackUsed: false,
        },
      },
    };
  }

  protected async resolveRealmId(realmId?: string): Promise<string> {
    return resolveRealmIdOrDefault(realmId, () =>
      this.financials.getDefaultRealmId(),
    );
  }

  protected asRecord(value: unknown): Record<string, unknown> {
    return asRecord(value);
  }

  protected asArray(value: unknown): Record<string, unknown>[] {
    return asRecordArray(value);
  }

  protected stringValue(value: unknown): string {
    return stringValue(value);
  }

  protected numberValue(value: unknown): number {
    return numberValue(value);
  }

  protected trim(value: unknown): string {
    return trim(value);
  }

  protected normalizeName(value: unknown): string {
    return normalizeName(value);
  }

  protected money(value: number): number {
    return money(value);
  }
}

