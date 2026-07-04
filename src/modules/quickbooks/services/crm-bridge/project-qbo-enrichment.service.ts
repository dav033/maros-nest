import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus } from '../../../../common/enums/invoice-status.enum';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import {
  EnrichmentOptions,
  QboEnrichmentError,
  QboPaymentSummary,
  QboProjectFullProfile,
  QboProjectSummary,
} from './project-qbo-enrichment.types';

type ProjectDtoLike = Record<string, unknown> & {
  lead?: { leadNumber?: string | null } | null;
};

type LeadDtoLike = Record<string, unknown> & {
  leadNumber?: string | null;
  project?: Record<string, unknown> | null;
};

@Injectable()
export class ProjectQboEnrichmentService {
  private readonly logger = new Logger(ProjectQboEnrichmentService.name);

  constructor(
    private readonly quickbooksFinancialsService: QuickbooksFinancialsService,
  ) {}

  async enrichProjectSummary<T extends ProjectDtoLike>(
    dto: T,
    options: EnrichmentOptions = {},
  ): Promise<T> {
    const leadNumber = dto.lead?.leadNumber ?? undefined;
    if (!leadNumber) {
      this.attachEmpty(dto);
      return dto;
    }

    try {
      const [financials, payments] = await Promise.all([
        this.quickbooksFinancialsService.getProjectFinancials(
          [leadNumber],
          options.realmId,
        ),
        this.fetchPayments(leadNumber, options.realmId),
      ]);
      this.attachSummary(dto, leadNumber, financials[0] ?? null, payments);
    } catch (error) {
      this.attachError(dto, error, `project summary for ${leadNumber}`);
    }

    return dto;
  }

  async enrichProjectsSummary<T extends ProjectDtoLike>(
    dtos: T[],
    options: EnrichmentOptions = {},
  ): Promise<T[]> {
    const leadNumbers = dtos
      .map((dto) => dto.lead?.leadNumber)
      .filter((value): value is string => !!value);

    if (leadNumbers.length === 0) {
      dtos.forEach((dto) => this.attachEmpty(dto));
      return dtos;
    }

    try {
      const financials = await this.quickbooksFinancialsService.getProjectFinancials(
        leadNumbers,
        options.realmId,
      );
      const financialMap = new Map(
        financials.map((financial) => [financial.projectNumber, financial]),
      );

      dtos.forEach((dto) => {
        const leadNumber = dto.lead?.leadNumber;
        if (!leadNumber) {
          this.attachEmpty(dto);
          return;
        }
        this.attachSummary(
          dto,
          leadNumber,
          financialMap.get(leadNumber) ?? null,
        );
      });
    } catch (error) {
      dtos.forEach((dto) =>
        this.attachError(
          dto,
          error,
          `batch summary for ${leadNumbers.length} projects`,
        ),
      );
    }

    return dtos;
  }

  async enrichProjectFullProfile<T extends ProjectDtoLike>(
    dto: T,
    options: EnrichmentOptions = {},
  ): Promise<T> {
    const leadNumber = dto.lead?.leadNumber ?? undefined;
    if (!leadNumber) {
      this.attachEmpty(dto);
      return dto;
    }

    try {
      const profile = await this.quickbooksFinancialsService.getProjectFullProfile(
        leadNumber,
        options.realmId,
      );
      this.attachFullProfile(dto, profile);
    } catch (error) {
      this.attachError(dto, error, `full profile for ${leadNumber}`);
    }

    return dto;
  }

  async enrichLead<T extends LeadDtoLike>(
    dto: T,
    options: EnrichmentOptions = {},
  ): Promise<T> {
    const leadNumber = dto.leadNumber ?? undefined;
    if (!leadNumber) {
      this.attachEmpty(dto);
      return dto;
    }

    const projectShim: ProjectDtoLike = { lead: { leadNumber } };

    if (options.depth === 'full') {
      await this.enrichProjectFullProfile(projectShim, options);
    } else {
      await this.enrichProjectSummary(projectShim, options);
    }

    this.copyAttachments(projectShim, dto);
    return dto;
  }

  async enrichLeads<T extends LeadDtoLike>(
    dtos: T[],
    options: EnrichmentOptions = {},
  ): Promise<T[]> {
    const shims: ProjectDtoLike[] = dtos.map((dto) => ({
      lead: { leadNumber: dto.leadNumber ?? undefined },
    }));

    await this.enrichProjectsSummary(shims, options);

    dtos.forEach((dto, index) => this.copyAttachments(shims[index], dto));
    return dtos;
  }

  private async fetchPayments(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboPaymentSummary[] | undefined> {
    try {
      const txns = await this.quickbooksFinancialsService.getPaymentsByProject(
        projectNumber,
        realmId,
      );

      if (!Array.isArray(txns) || txns.length === 0) return undefined;

      return txns
        .map((txn): QboPaymentSummary => {
          const linkedInvoice = txn.linkedTxn.find(
            (linked) => linked.txnType?.toLowerCase() === 'invoice',
          )?.txnId;

          return {
            id: txn.entityId || undefined,
            date: txn.txnDate || undefined,
            amount: typeof txn.totalAmount === 'number' ? txn.totalAmount : 0,
            method: txn.account?.name || undefined,
            reference: txn.docNumber || undefined,
            linkedInvoice,
          };
        })
        .filter((payment) => Number.isFinite(payment.amount));
    } catch (error) {
      this.logger.error(
        `Error fetching payments for project ${projectNumber}: ${this.errorMessage(error)}`,
      );
      return undefined;
    }
  }

  private attachSummary(
    dto: ProjectDtoLike,
    projectNumber: string,
    financial: Partial<QboProjectSummary> | null,
    payments?: QboPaymentSummary[],
  ): void {
    // found === false: el lead/proyecto no existe como customer en QBO.
    // Se adjunta vacío (financial = null) para que la UI muestre "—" en vez
    // de montos $0.00 que parecen datos reales.
    if (!financial || financial.found === false) {
      this.attachEmpty(dto);
      return;
    }

    const merged: QboProjectSummary = {
      ...(financial as QboProjectSummary),
      projectNumber: financial.projectNumber ?? projectNumber,
      payments: payments ?? financial.payments,
    };
    const invoiceStatus = this.deriveInvoiceStatus(merged);
    if (invoiceStatus !== undefined) merged.invoiceStatus = invoiceStatus;

    dto.financial = merged;
    dto.invoiceStatus = invoiceStatus;
    dto.qbo = merged;
  }

  private attachFullProfile(
    dto: ProjectDtoLike,
    profile: QboProjectFullProfile,
  ): void {
    const invoiceStatus = this.deriveInvoiceStatus(profile.financials);
    const enriched: QboProjectFullProfile = { ...profile };
    if (invoiceStatus !== undefined) enriched.invoiceStatus = invoiceStatus;

    dto.financial = {
      ...profile.financials,
      projectNumber: profile.projectNumber,
      found: profile.found,
      payments: profile.payments,
    };
    dto.invoiceStatus = invoiceStatus;
    dto.qbo = enriched;
  }

  private attachEmpty(dto: ProjectDtoLike): void {
    dto.financial = null;
    dto.invoiceStatus = undefined;
    dto.qbo = { data: null };
  }

  private attachError(dto: ProjectDtoLike, error: unknown, context: string): void {
    const enrichmentError = this.toEnrichmentError(error);
    this.logger.error(`Error enriching ${context}: ${enrichmentError.message}`);
    dto.financial = null;
    dto.invoiceStatus = undefined;
    dto.qbo = { data: null, error: enrichmentError };
  }

  private copyAttachments(source: ProjectDtoLike, target: LeadDtoLike): void {
    target.financial = source.financial as never;
    target.invoiceStatus = source.invoiceStatus as never;
    target.qbo = source.qbo as never;
  }

  private deriveInvoiceStatus(
    financial: { invoicedAmount?: number; outstandingAmount?: number } | null,
  ): InvoiceStatus | undefined {
    if (!financial) return undefined;

    const invoicedAmount =
      typeof financial.invoicedAmount === 'number' ? financial.invoicedAmount : 0;
    const outstandingAmount =
      typeof financial.outstandingAmount === 'number'
        ? financial.outstandingAmount
        : 0;

    if (invoicedAmount <= 0) return InvoiceStatus.NOT_EXECUTED;
    if (outstandingAmount <= 0) return InvoiceStatus.PAID;
    return InvoiceStatus.PENDING;
  }

  private toEnrichmentError(error: unknown): QboEnrichmentError {
    const message = this.errorMessage(error);
    const connectionIssue =
      error instanceof QboReauthorizationRequiredException ||
      message.includes('requires manual reauthorization') ||
      message.includes('QBO_REAUTHORIZATION_REQUIRED') ||
      message.includes('QuickBooks connection');

    return connectionIssue
      ? {
          code: 'qbo_connection_required',
          message:
            'QuickBooks no está conectado o necesita autorización. Reconecta antes de consultar información financiera.',
        }
      : {
          code: 'qbo_query_failed',
          message: 'No se pudo consultar QuickBooks con esos datos.',
        };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
