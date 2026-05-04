import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  buildTxnQueries,
  emptyDetail,
  parseProfitAndLoss,
  transactionMatchesProject,
} from './quickbooks-financials.helpers';
import {
  ProjectFullProfile,
  QboEstimateResponse,
  QboInvoiceResponse,
  QboPaymentResponse,
} from './quickbooks-financials.types';
import { QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';
import { QuickbooksFinancialsAttachmentsService } from './quickbooks-financials-attachments.service';

@Injectable()
export class QuickbooksFinancialsProfileService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly contextService: QuickbooksFinancialsContextService,
    private readonly attachmentsService: QuickbooksFinancialsAttachmentsService,
  ) {}

  async getProjectFullProfile(
    projectNumber: string,
    realmId?: string,
  ): Promise<ProjectFullProfile> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId, jobObject } = await this.contextService.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );

    if (!jobId) {
      return {
        projectNumber,
        found: false,
        job: null,
        financials: emptyDetail(projectNumber).financials,
        estimates: [],
        invoices: [],
        payments: [],
        expenses: [],
        attachments: [],
        profitAndLoss: null,
      };
    }

    const { estimateQuery, invoiceQuery, paymentQuery } = buildTxnQueries([jobId], true);
    const [estimatesResp, invoicesResp, paymentsResp, purchases, plReport] = await Promise.all([
      this.apiService.query(effectiveRealmId, estimateQuery) as Promise<QboEstimateResponse>,
      this.apiService.query(effectiveRealmId, invoiceQuery) as Promise<QboInvoiceResponse>,
      this.apiService.query(effectiveRealmId, paymentQuery!) as Promise<QboPaymentResponse>,
      this.apiService.queryAll(effectiveRealmId, 'Purchase') as Promise<Record<string, unknown>[]>,
      this.apiService.report(effectiveRealmId, 'ProfitAndLoss', { customer: jobId }),
    ]);

    const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const payments = paymentsResp?.QueryResponse?.Payment ?? [];
    const projectPurchases = purchases.filter((purchase) =>
      transactionMatchesProject(
        this.normalizer.normalizePurchase(purchase),
        jobId,
        projectNumber,
        jobObject?.DisplayName,
      ),
    );

    const attachmentEntityRefs = this.attachmentsService.buildAttachmentEntityRefs(
      jobId,
      estimates,
      invoices,
      payments,
      projectPurchases,
    );
    const attachables = await this.attachmentsService.getAttachablesForEntityRefs(
      effectiveRealmId,
      attachmentEntityRefs,
    );
    const attachmentsByEntity = this.attachmentsService.groupAttachablesByEntity(attachables);

    const estTotal = estimates.reduce((s, e) => s + (Number(e.TotalAmt) || 0), 0);
    const invTotal = invoices.reduce((s, i) => s + (Number(i.TotalAmt) || 0), 0);
    const outstanding = invoices.reduce((s, i) => s + (Number(i.Balance) || 0), 0);
    const paidAmount = invTotal - outstanding;

    return {
      projectNumber,
      found: true,
      job: jobObject,
      financials: {
        estimatedAmount: estTotal,
        estimateCount: estimates.length,
        invoicedAmount: invTotal,
        invoiceCount: invoices.length,
        paidAmount,
        outstandingAmount: outstanding,
        paidPercentage: invTotal > 0 ? Math.round((paidAmount / invTotal) * 10000) / 100 : 0,
        estimateVsInvoicedDelta: estTotal - invTotal,
      },
      estimates: estimates.map((estimate) =>
        this.normalizer.normalizeEstimate(
          estimate,
          this.attachmentsService.attachmentsForEntity(
            attachmentsByEntity,
            'Estimate',
            estimate.Id,
          ),
        ),
      ),
      invoices: invoices.map((invoice) =>
        this.normalizer.normalizeInvoice(
          invoice,
          this.attachmentsService.attachmentsForEntity(
            attachmentsByEntity,
            'Invoice',
            invoice.Id,
          ),
        ),
      ),
      payments: payments.map((payment) =>
        this.normalizer.normalizePayment(
          payment,
          this.attachmentsService.attachmentsForEntity(
            attachmentsByEntity,
            'Payment',
            payment['Id'],
          ),
        ),
      ),
      expenses: projectPurchases.map((purchase) =>
        this.normalizer.normalizePurchase(
          purchase,
          this.attachmentsService.attachmentsForEntity(
            attachmentsByEntity,
            'Purchase',
            purchase['Id'],
          ),
        ),
      ),
      attachments: attachables.map((attachment) => this.normalizer.normalizeAttachable(attachment)),
      profitAndLoss: parseProfitAndLoss(projectNumber, jobId, plReport as Record<string, unknown>),
    };
  }
}

