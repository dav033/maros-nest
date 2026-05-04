import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { QuickbooksAttachmentsService } from '../attachments/quickbooks-attachments.service';
import { QboRef, QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import { QuickbooksVendorMatchingService } from '../vendor/quickbooks-vendor-matching.service';
import { QuickbooksJobCostingBase } from './quickbooks-job-costing.base';
import {
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

@Injectable()
export class QuickbooksJobCostingService extends QuickbooksJobCostingBase {
  constructor(
    apiService: QuickbooksApiService,
    normalizer: QuickbooksNormalizerService,
    financials: QuickbooksFinancialsService,
    attachmentsService: QuickbooksAttachmentsService,
    vendorMatching: QuickbooksVendorMatchingService,
    private readonly projectProfile: QuickbooksJobCostingProjectProfileService,
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
}
