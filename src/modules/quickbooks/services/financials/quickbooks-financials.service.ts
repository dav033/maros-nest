import { Injectable } from '@nestjs/common';
import {
  QboCashInTransaction,
  QboNormalizedTransaction,
} from '../core/quickbooks-normalizer.service';
import {
  AttachmentItem,
  ExpenseItem,
  InvoiceSummary,
  ProjectDetail,
  ProjectFinancials,
  ProjectFullProfile,
  ProjectProfitAndLoss,
  UnbilledWorkResult,
} from './quickbooks-financials.types';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';
import { QuickbooksFinancialsProfileService } from './quickbooks-financials-profile.service';
import { QuickbooksFinancialsProfitLossService } from './quickbooks-financials-profit-loss.service';
import { QuickbooksFinancialsProjectsService } from './quickbooks-financials-projects.service';

export type {
  AttachmentItem,
  ExpenseItem,
  InvoiceSummary,
  ProjectDetail,
  ProjectFinancials,
  ProjectFullProfile,
  ProjectProfitAndLoss,
  UnbilledWorkResult,
} from './quickbooks-financials.types';

@Injectable()
export class QuickbooksFinancialsService {
  constructor(
    private readonly contextService: QuickbooksFinancialsContextService,
    private readonly projectsService: QuickbooksFinancialsProjectsService,
    private readonly profitLossService: QuickbooksFinancialsProfitLossService,
    private readonly profileService: QuickbooksFinancialsProfileService,
  ) {}

  async getProjectFinancials(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<ProjectFinancials[]> {
    return this.projectsService.getProjectFinancials(projectNumbers, realmId);
  }

  async getProjectDetail(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<ProjectDetail[]> {
    return this.projectsService.getProjectDetail(projectNumbers, realmId);
  }

  async getInvoicesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<InvoiceSummary[]> {
    return this.projectsService.getInvoicesByProject(projectNumber, realmId);
  }

  async getInvoiceById(
    invoiceId: string,
    realmId?: string,
  ): Promise<QboCashInTransaction> {
    return this.projectsService.getInvoiceById(invoiceId, realmId);
  }

  async getEstimatesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboNormalizedTransaction[]> {
    return this.projectsService.getEstimatesByProject(projectNumber, realmId);
  }

  async getEstimateById(
    estimateId: string,
    realmId?: string,
  ): Promise<QboNormalizedTransaction> {
    return this.projectsService.getEstimateById(estimateId, realmId);
  }

  async getPaymentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<QboCashInTransaction[]> {
    return this.projectsService.getPaymentsByProject(projectNumber, realmId);
  }

  async getUnbilledWork(
    projectNumber: string,
    realmId?: string,
  ): Promise<UnbilledWorkResult> {
    return this.projectsService.getUnbilledWork(projectNumber, realmId);
  }

  async getExpensesByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<ExpenseItem[]> {
    return this.projectsService.getExpensesByProject(projectNumber, realmId);
  }

  async getAttachmentsByProject(
    projectNumber: string,
    realmId?: string,
  ): Promise<AttachmentItem[]> {
    return this.projectsService.getAttachmentsByProject(projectNumber, realmId);
  }

  async getProjectProfitAndLoss(
    projectNumber: string,
    realmId?: string,
  ): Promise<ProjectProfitAndLoss> {
    return this.profitLossService.getProjectProfitAndLoss(projectNumber, realmId);
  }

  async getProjectFullProfile(
    projectNumber: string,
    realmId?: string,
  ): Promise<ProjectFullProfile> {
    return this.profileService.getProjectFullProfile(projectNumber, realmId);
  }

  async getDefaultRealmId(): Promise<string> {
    return this.contextService.resolveDefaultRealmId();
  }
}

