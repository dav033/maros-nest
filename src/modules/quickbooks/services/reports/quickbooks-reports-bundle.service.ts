import { Injectable } from '@nestjs/common';
import { QuickbooksReportsContextService } from './quickbooks-reports.context.service';
import { QuickbooksReportsFinancialService } from './quickbooks-reports-financial.service';
import { ProjectReportBundle, ReportParams } from './quickbooks-reports.types';

@Injectable()
export class QuickbooksReportsBundleService {
  constructor(
    private readonly contextService: QuickbooksReportsContextService,
    private readonly financialService: QuickbooksReportsFinancialService,
  ) {}

  async getProjectReportBundle(params: ReportParams): Promise<ProjectReportBundle> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    const normalized: ReportParams = { ...params, realmId: rid };
    const warnings: string[] = [];

    const safe = async <T>(
      getter: () => Promise<T>,
      name: string,
      fallback: T,
    ): Promise<T> => {
      try {
        return await getter();
      } catch (error) {
        warnings.push(`${name}: ${(error as Error).message}`);
        return fallback;
      }
    };

    const [
      profitAndLoss,
      profitAndLossDetail,
      vendorExpenses,
      agedPayables,
      vendorBalanceDetail,
    ] = await Promise.all([
      safe(
        () => this.financialService.getProfitAndLoss(normalized),
        'ProfitAndLoss',
        this.financialService.emptyParsedReport('ProfitAndLoss', normalized),
      ),
      safe(
        () => this.financialService.getProfitAndLossDetail(normalized),
        'ProfitAndLossDetail',
        this.financialService.emptyParsedReport('ProfitAndLossDetail', normalized),
      ),
      safe(
        () => this.financialService.getVendorExpenses(normalized),
        'VendorExpenses',
        this.financialService.emptyParsedReport('VendorExpenses', normalized),
      ),
      safe(
        () => this.financialService.getAgedPayables(normalized),
        'AgedPayables',
        this.financialService.emptyParsedReport('AgedPayables', normalized),
      ),
      safe(
        () => this.financialService.getVendorBalanceDetail(normalized),
        'VendorBalanceDetail',
        this.financialService.emptyParsedReport('VendorBalanceDetail', normalized),
      ),
    ]);

    return {
      customerId: normalized.customerId,
      profitAndLoss,
      profitAndLossDetail,
      vendorExpenses,
      agedPayables,
      vendorBalanceDetail,
      warnings,
      coverage: this.financialService.buildCoverage(normalized),
    };
  }
}
