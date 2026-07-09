import { Injectable } from '@nestjs/common';
import { parseProfitAndLoss } from './quickbooks-financials.helpers';
import { ProjectProfitAndLoss } from './quickbooks-financials.types';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';

@Injectable()
export class QuickbooksFinancialsProfitLossService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly contextService: QuickbooksFinancialsContextService,
  ) {}

  async getProjectProfitAndLoss(
    projectNumber: string,
    realmId?: string,
    range?: { startDate: string; endDate: string },
    accountingMethod?: 'Cash' | 'Accrual',
  ): Promise<ProjectProfitAndLoss> {
    const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId } = await this.contextService.resolveSingleJob(projectNumber, effectiveRealmId);

    if (!jobId) {
      return {
        projectNumber,
        found: false,
        customerId: null,
        income: { total: 0, categories: [] },
        costOfGoodsSold: { total: 0, categories: [] },
        expenses: { total: 0, categories: [] },
        grossProfit: 0,
        netProfit: 0,
      };
    }

    const report = (await this.apiService.report(effectiveRealmId, 'ProfitAndLoss', {
      customer: jobId,
      ...(range && { start_date: range.startDate, end_date: range.endDate }),
      ...(accountingMethod && { accounting_method: accountingMethod }),
    })) as Record<string, unknown>;

    return parseProfitAndLoss(projectNumber, jobId, report);
  }
}

