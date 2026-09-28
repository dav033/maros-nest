import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { QuickbooksAttachmentsService } from '../attachments/quickbooks-attachments.service';
import { QboRef, QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import { QuickbooksVendorMatchingService } from '../vendor/quickbooks-vendor-matching.service';
import { QuickbooksJobCostingBase } from './quickbooks-job-costing.base';
import {
  QboCustomerRecord,
  QboJobCostSummary,
  QboJobCostingParams,
  QboProjectApStatusResult,
  QboProjectCashOutResult,
  QboProjectJobCostSummaryResult,
  QboProjectVendorTransactionsResult,
  QboResolvedProjectRef,
  QboVendorTransactionsResult,
} from './quickbooks-job-costing.types';
import { QuickbooksJobCostingProjectProfileService } from './quickbooks-job-costing-profile.service';
import { QuickbooksJobCostingProfileContext } from './quickbooks-job-costing-profile.types';

const JOB_COST_SUMMARIES_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class QuickbooksJobCostingService extends QuickbooksJobCostingBase {
  constructor(
    apiService: QuickbooksApiService,
    normalizer: QuickbooksNormalizerService,
    financials: QuickbooksFinancialsService,
    attachmentsService: QuickbooksAttachmentsService,
    vendorMatching: QuickbooksVendorMatchingService,
    private readonly projectProfile: QuickbooksJobCostingProjectProfileService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super(apiService, normalizer, financials, attachmentsService, vendorMatching);
  }

  async getProjectCashOut(
    params: QboJobCostingParams,
  ): Promise<QboProjectCashOutResult> {
    const project = await this.findProjectRefs(params);
    if (!this.hasProjectIdentity(project)) {
      const warnings = [
        this.normalizer.warning(
          'PROJECT_NOT_RESOLVED',
          'Provide projectNumber or qboCustomerId to calculate project cash out.',
        ),
      ];
      return this.emptyProjectResult(project, params, warnings);
    }

    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: true,
    });

    return {
      project,
      summary: result.summary,
      transactions: result.transactions,
      vendorBreakdown: result.vendorBreakdown,
      categoryBreakdown: result.categoryBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async getProjectJobCostSummaries(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<Map<string, QboJobCostSummary>> {
    const projectNumbersClean = [...new Set(projectNumbers.map((value) => this.trim(value)).filter(Boolean))];
    if (!projectNumbersClean.length) return new Map();

    // Recorrer el libro de compras completo (3k+ transacciones) por cada carga
    // del listado costaba ~7s. El costo por trabajo se mueve con el ritmo al
    // que se registran facturas y gastos, no con el de las recargas de pagina.
    // La generacion del indice de jobs va en la clave: importar o desvincular
    // un proyecto cambia a que job pertenece cada cifra, e `invalidateJobIndex()`
    // tiene que tirar tambien estas sumas, no solo el indice.
    const cacheKey = `qbo:job-cost-summaries:${this.financials.jobIndexGeneration}:${realmId ?? 'default'}:${[...projectNumbersClean].sort().join(',')}`;
    const cached = await this.cacheManager.get<Array<[string, QboJobCostSummary]>>(cacheKey);
    if (cached) return new Map(cached);

    const effectiveRealmId = await this.resolveRealmId(realmId);
    const projects = await this.findProjectRefsBatch(projectNumbersClean, effectiveRealmId);
    if (![...projects.values()].some((project) => this.hasProjectIdentity(project))) {
      return new Map();
    }

    const params = { realmId: effectiveRealmId };
    const rawBundle = await this.fetchCostBundle(effectiveRealmId, params);
    const billIndex = new Map<string, Record<string, unknown>>();
    for (const bill of rawBundle.bills) {
      const id = this.stringValue(bill['Id']);
      if (id) billIndex.set(id, bill);
    }
    await this.loadLinkedBillsForPayments(effectiveRealmId, rawBundle.billPayments, billIndex, []);

    const summaries = new Map<string, QboJobCostSummary>();
    for (const projectNumber of projectNumbersClean) {
      const project = projects.get(projectNumber);
      if (!project || !this.hasProjectIdentity(project)) continue;
      const descriptors = this.buildTransactionDescriptors(
        rawBundle,
        billIndex,
        project,
        true,
        params,
        [],
      );
      summaries.set(projectNumber, this.summarize(descriptors));
    }
    await this.cacheManager.set(cacheKey, [...summaries.entries()], JOB_COST_SUMMARIES_CACHE_TTL_MS);
    return summaries;
  }

  async getProjectVendorTransactions(
    params: QboJobCostingParams,
  ): Promise<QboProjectVendorTransactionsResult> {
    const project = await this.findProjectRefs(params);
    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: true,
    });

    return {
      project,
      transactions: result.transactions.filter((txn) => txn.vendor),
      vendorBreakdown: result.vendorBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async getProjectApStatus(
    params: QboJobCostingParams,
  ): Promise<QboProjectApStatusResult> {
    const project = await this.findProjectRefs(params);
    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: true,
    });

    return {
      project,
      summary: {
        openAp: result.summary.openAp,
        vendorCredits: result.summary.vendorCredits,
      },
      openBills: result.transactions.filter(
        (txn) => txn.classification === 'open_ap',
      ),
      billPayments: result.transactions.filter(
        (txn) =>
          txn.classification === 'cash_out_paid' &&
          txn.entityType === 'BillPayment',
      ),
      vendorCredits: result.transactions.filter(
        (txn) => txn.classification === 'credit',
      ),
      vendorBreakdown: result.vendorBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async getProjectJobCostSummary(
    params: QboJobCostingParams,
  ): Promise<QboProjectJobCostSummaryResult> {
    const realmId = await this.resolveRealmId(params.realmId);
    const normalizedParams: QboJobCostingParams = { ...params, realmId };
    const project = await this.findProjectRefs(normalizedParams);
    if (!this.hasProjectIdentity(project)) {
      return this.projectProfile.emptyFullProjectResult({
        realmId,
        project,
        params: normalizedParams,
        warnings: [
          this.normalizer.warning(
            'PROJECT_NOT_RESOLVED',
            'Provide projectNumber or qboCustomerId to build the project financial profile.',
          ),
        ],
        context: this.profileContext(),
      });
    }

    const jobCost = await this.collectJobCost(normalizedParams, {
      project,
      requireProjectMatch: true,
    });

    return this.projectProfile.buildProjectJobCostSummary({
      realmId,
      project,
      params: normalizedParams,
      jobCost,
      context: this.profileContext(),
    });
  }

  async getVendorTransactions(
    params: QboJobCostingParams,
  ): Promise<QboVendorTransactionsResult> {
    const project =
      params.projectNumber || params.qboCustomerId
        ? await this.findProjectRefs(params)
        : undefined;
    const result = await this.collectJobCost(params, {
      project,
      requireProjectMatch: !!project,
    });

    return {
      vendorFilter: {
        ...(params.vendorId && { vendorId: params.vendorId }),
        ...(params.vendorName && { vendorName: params.vendorName }),
      },
      ...(project && { project }),
      summary: result.summary,
      transactions: result.transactions,
      categoryBreakdown: result.categoryBreakdown,
      warnings: result.warnings,
      coverage: result.coverage,
    };
  }

  async findProjectRefs(
    params: Pick<
      QboJobCostingParams,
      'realmId' | 'projectNumber' | 'qboCustomerId'
    >,
  ): Promise<QboResolvedProjectRef> {
    const projectNumber = this.trim(params.projectNumber);
    const qboCustomerId = this.trim(params.qboCustomerId);

    if (!projectNumber && !qboCustomerId) {
      return { found: false, refs: [] };
    }

    const realmId = await this.resolveRealmId(params.realmId);

    if (qboCustomerId) {
      return this.projectRefFromCustomerId(realmId, projectNumber, qboCustomerId);
    }

    const linkedJobIds = await this.financials.getProjectJobIds([projectNumber], realmId);
    const linkedJobId = linkedJobIds[projectNumber];
    if (linkedJobId) return this.projectRefFromCustomerId(realmId, projectNumber, linkedJobId);

    const customers = await this.findCustomersForProjectNumber(realmId, projectNumber);
    const match = customers[0];

    if (!match) {
      return {
        found: false,
        projectNumber,
        refs: [{ value: '', name: projectNumber }],
      };
    }

    const id = this.stringValue(match.Id);
    const displayName = this.stringValue(match.DisplayName);
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
      raw: match,
    };
  }

  private profileContext(): QuickbooksJobCostingProfileContext {
    return {
      asRecord: this.asRecord.bind(this),
      buildWhereOptions: (...parts) => this.buildWhereOptions(...parts),
      projectCustomerId: this.projectCustomerId.bind(this),
      transactionMatchesProject: this.transactionMatchesProject.bind(this),
      entityKey: this.entityKey.bind(this),
      money: this.money.bind(this),
      isAcceptedEstimate: this.isAcceptedEstimate.bind(this),
      hasLineWithoutProjectRef: this.hasLineWithoutProjectRef.bind(this),
      isProportionalBillPaymentAllocation:
        this.isProportionalBillPaymentAllocation.bind(this),
      uniqueStrings: this.uniqueStrings.bind(this),
      trim: this.trim.bind(this),
    };
  }

  private async findProjectRefsBatch(
    projectNumbers: string[],
    realmId: string,
  ): Promise<Map<string, QboResolvedProjectRef>> {
    const linkedJobIds = await this.financials.getProjectJobIds(projectNumbers, realmId);
    // Solo se emparejan Id/DisplayName/FullyQualifiedName (customerMatchesProjectNumber),
    // y los refs que salen de aqui no exponen el customer crudo. Pedir `SELECT *`
    // de todos los customers era lo mas caro del listado.
    const customerFields = 'Id, DisplayName, FullyQualifiedName';
    const jobs = this.asArray(
      await this.apiService.queryAll(realmId, 'Customer', {
        where: 'Job = true',
        select: customerFields,
        cacheKey: 'job-costing-refs',
      }),
    ) as QboCustomerRecord[];
    const missingJobs = projectNumbers.some(
      (projectNumber) => !jobs.some((customer) => this.customerMatchesProjectNumber(customer, projectNumber)),
    );
    const customers = missingJobs
      ? (this.asArray(
          await this.apiService.queryAll(realmId, 'Customer', {
            select: customerFields,
            cacheKey: 'job-costing-refs',
          }),
        ) as QboCustomerRecord[])
      : [];

    const refs = new Map<string, QboResolvedProjectRef>();
    for (const projectNumber of projectNumbers) {
      const match =
        (linkedJobIds[projectNumber]
          ? jobs.find((customer) => this.stringValue(customer.Id) === linkedJobIds[projectNumber])
          : undefined) ??
        jobs.find((customer) => this.customerMatchesProjectNumber(customer, projectNumber)) ??
        customers.find((customer) => this.customerMatchesProjectNumber(customer, projectNumber));
      if (!match) {
        refs.set(projectNumber, {
          found: false,
          projectNumber,
          refs: [{ value: '', name: projectNumber }],
        });
        continue;
      }

      const id = this.stringValue(match.Id);
      const displayName = this.stringValue(match.DisplayName);
      refs.set(projectNumber, {
        found: true,
        projectNumber,
        qboCustomerId: id,
        ...(displayName && { displayName }),
        refs: [{ value: id, ...(displayName && { name: displayName }) }],
        raw: match,
      });
    }
    return refs;
  }

  private async projectRefFromCustomerId(
    realmId: string,
    projectNumber: string,
    qboCustomerId: string,
  ): Promise<QboResolvedProjectRef> {
    const raw = await this.fetchCustomerById(realmId, qboCustomerId);
    const displayName = this.stringValue(raw['DisplayName']);
    const ref: QboRef = {
      value: qboCustomerId,
      ...(displayName && { name: displayName }),
    };
    return {
      found: true,
      ...(projectNumber && { projectNumber }),
      qboCustomerId,
      ...(displayName && { displayName }),
      refs: [ref],
      ...(Object.keys(raw).length && { raw }),
    };
  }
}
