import { Injectable } from '@nestjs/common';
import {
  QboCashInTransaction,
  QboNormalizedTransaction,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  aggregateFinancials,
  buildTxnQueries,
  deduplicateProjectNumbers,
  emptyDetail,
  emptyFinancials,
  indexByJobId,
  transactionMatchesProject,
} from './quickbooks-financials.helpers';
import {
  ExpenseItem,
  InvoiceSummary,
  ProjectDetail,
  ProjectFinancials,
  QboEstimateResponse,
  QboInvoice,
  QboInvoiceResponse,
  QboPaymentResponse,
  QboTxnBase,
  UnbilledWorkResult,
} from './quickbooks-financials.types';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';
import { QuickbooksFinancialsAttachmentsService } from './quickbooks-financials-attachments.service';

@Injectable()
export class QuickbooksFinancialsProjectsService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly contextService: QuickbooksFinancialsContextService,
    private readonly attachmentsService: QuickbooksFinancialsAttachmentsService,
  ) {}

  async getProjectFinancials(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<ProjectFinancials[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const cleaned = deduplicateProjectNumbers(projectNumbers);
    if (!cleaned.length) return [];

    const ctx = await this.contextService.resolveJobs(effectiveRealmId, cleaned);
    if (!ctx.jobIds.length) return cleaned.map((pn) => emptyFinancials(pn));

    const { estimateQuery, invoiceQuery } = buildTxnQueries(ctx.jobIds, false);
    const [estimatesResp, invoicesResp] = await Promise.all([
      this.apiService.query(effectiveRealmId, estimateQuery) as Promise<QboEstimateResponse>,
      this.apiService.query(effectiveRealmId, invoiceQuery) as Promise<QboInvoiceResponse>,
    ]);

    return aggregateFinancials(cleaned, ctx.jobMap, estimatesResp, invoicesResp);
  }

  async getProjectDetail(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<ProjectDetail[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const cleaned = deduplicateProjectNumbers(projectNumbers);
    if (!cleaned.length) return [];

    const ctx = await this.contextService.resolveJobs(effectiveRealmId, cleaned);
    if (!ctx.jobIds.length) return cleaned.map((pn) => emptyDetail(pn));

    const { estimateQuery, invoiceQuery, paymentQuery } = buildTxnQueries(ctx.jobIds, true);
    const [estimatesResp, invoicesResp, paymentsResp] = await Promise.all([
      this.apiService.query(effectiveRealmId, estimateQuery) as Promise<QboEstimateResponse>,
      this.apiService.query(effectiveRealmId, invoiceQuery) as Promise<QboInvoiceResponse>,
      this.apiService.query(effectiveRealmId, paymentQuery!) as Promise<QboPaymentResponse>,
    ]);

    const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const payments = paymentsResp?.QueryResponse?.Payment ?? [];

    const estsByJob = indexByJobId<QboTxnBase>(estimates);
    const invsByJob = indexByJobId<QboInvoice>(invoices);
    const paysByJob = indexByJobId<Record<string, unknown>>(payments);

    return cleaned.map((pn) => {
      const jobId = ctx.jobMap[pn];
      if (!jobId) return emptyDetail(pn);

      const projEstimates = estsByJob[jobId] ?? [];
      const projInvoices = invsByJob[jobId] ?? [];
      const projPayments = paysByJob[jobId] ?? [];
      const estTotal = projEstimates.reduce((s, e) => s + (Number(e.TotalAmt) || 0), 0);
      const invTotal = projInvoices.reduce((s, i) => s + (Number(i.TotalAmt) || 0), 0);
      const outstanding = projInvoices.reduce((s, i) => s + (Number(i.Balance) || 0), 0);
      const paidAmount = invTotal - outstanding;
      const paidPercentage = invTotal > 0 ? (paidAmount / invTotal) * 100 : 0;

      return {
        projectNumber: pn,
        found: true,
        job: ctx.jobObjectMap[pn] ?? null,
        financials: {
          estimatedAmount: estTotal,
          estimateCount: projEstimates.length,
          invoicedAmount: invTotal,
          invoiceCount: projInvoices.length,
          paidAmount,
          outstandingAmount: outstanding,
          paidPercentage: Math.round(paidPercentage * 100) / 100,
          estimateVsInvoicedDelta: estTotal - invTotal,
        },
        estimates: projEstimates.map((estimate) => this.normalizer.normalizeEstimate(estimate)),
        invoices: projInvoices.map((invoice) => this.normalizer.normalizeInvoice(invoice)),
        payments: projPayments.map((payment) => this.normalizer.normalizePayment(payment)),
      };
    });
  }

  async getInvoicesByProject(projectNumber: string, realmId?: string): Promise<InvoiceSummary[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId } = await this.contextService.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Invoice WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Invoice?: QboInvoice[] } };

    return (resp?.QueryResponse?.Invoice ?? []).map((invoice) => this.normalizer.normalizeInvoice(invoice));
  }

  async getInvoiceById(invoiceId: string, realmId?: string): Promise<QboCashInTransaction> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const resp = await this.apiService.getById(effectiveRealmId, 'invoice', invoiceId);
    return this.normalizer.normalizeInvoice(this.apiService.unwrapQboEntity(resp, 'Invoice'));
  }

  async getEstimatesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboNormalizedTransaction[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId } = await this.contextService.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Estimate WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Estimate?: unknown[] } };

    return (resp?.QueryResponse?.Estimate ?? []).map((estimate) =>
      this.normalizer.normalizeEstimate(estimate as Record<string, unknown>),
    );
  }

  async getEstimateById(
    estimateId: string,
    realmId?: string,
  ): Promise<QboNormalizedTransaction> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const resp = await this.apiService.getById(effectiveRealmId, 'estimate', estimateId);
    return this.normalizer.normalizeEstimate(this.apiService.unwrapQboEntity(resp, 'Estimate'));
  }

  async getPaymentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboCashInTransaction[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId } = await this.contextService.resolveSingleJob(projectNumber, effectiveRealmId);
    if (!jobId) return [];

    const resp = (await this.apiService.query(
      effectiveRealmId,
      `SELECT * FROM Payment WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Payment?: unknown[] } };

    return (resp?.QueryResponse?.Payment ?? []).map((payment) =>
      this.normalizer.normalizePayment(payment as Record<string, unknown>),
    );
  }

  async getUnbilledWork(projectNumber: string, realmId?: string): Promise<UnbilledWorkResult> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.contextService.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );

    const empty: UnbilledWorkResult = {
      projectNumber,
      found: !!jobId,
      job: jobObject,
      totalEstimated: 0,
      totalInvoiced: 0,
      unbilledAmount: 0,
      estimates: [],
      invoices: [],
    };
    if (!jobId) return empty;

    const [estResp, invResp] = await Promise.all([
      this.apiService.query(
        effectiveRealmId,
        `SELECT * FROM Estimate WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<{ QueryResponse?: { Estimate?: QboTxnBase[] } }>,
      this.apiService.query(
        effectiveRealmId,
        `SELECT * FROM Invoice WHERE CustomerRef IN ('${jobId}') STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<{ QueryResponse?: { Invoice?: QboInvoice[] } }>,
    ]);

    const estimates = estResp?.QueryResponse?.Estimate ?? [];
    const invoices = invResp?.QueryResponse?.Invoice ?? [];
    const totalEstimated = estimates.reduce((s, e) => s + (Number(e.TotalAmt) || 0), 0);
    const totalInvoiced = invoices.reduce((s, i) => s + (Number(i.TotalAmt) || 0), 0);

    return {
      projectNumber,
      found: true,
      job: jobObject,
      totalEstimated,
      totalInvoiced,
      unbilledAmount: totalEstimated - totalInvoiced,
      estimates: estimates.map((estimate) => this.normalizer.normalizeEstimate(estimate)),
      invoices: invoices.map((invoice) => this.normalizer.normalizeInvoice(invoice)),
    };
  }

  async getExpensesByProject(projectNumber: string, realmId?: string): Promise<ExpenseItem[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.contextService.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const purchases = (await this.apiService.queryAll(
      effectiveRealmId,
      'Purchase',
    )) as Record<string, unknown>[];

    return purchases
      .map((purchase) => this.normalizer.normalizePurchase(purchase))
      .filter((purchase) =>
        transactionMatchesProject(purchase, jobId, projectNumber, jobObject?.DisplayName),
      );
  }

  async getAttachmentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<import('./quickbooks-financials.types').AttachmentItem[]> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.contextService.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) return [];

    const entityRefs = await this.attachmentsService.getProjectRelatedEntityRefs(
      effectiveRealmId,
      projectNumber,
      jobId,
      jobObject?.DisplayName,
    );
    const attachables = await this.attachmentsService.getAttachablesForEntityRefs(
      effectiveRealmId,
      entityRefs,
    );

    return attachables.map((attachment) => this.normalizer.normalizeAttachable(attachment));
  }
}

