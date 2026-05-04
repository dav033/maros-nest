import { Injectable } from '@nestjs/common';
import { QuickbooksReportsBundleService } from './quickbooks-reports-bundle.service';
import { QuickbooksReportsFinancialService } from './quickbooks-reports-financial.service';
import { QuickbooksReportsOperationalService } from './quickbooks-reports-operational.service';
import {
  AgingReport,
  BacklogItem,
  ClientRevenueItem,
  FinancialSearchCriteria,
  FinancialSearchResult,
  ParsedReport,
  ProjectReportBundle,
  ReportParams,
  RevenueByPeriodResult,
  OutstandingBalanceItem,
} from './quickbooks-reports.types';

export {
  splitDateRange,
  extractColumnTitles,
  parseQboReportRows,
  buildReportSummary,
} from './quickbooks-reports.parser';

export type {
  AgingInvoiceItem,
  AgingBucket,
  AgingReport,
  OutstandingBalanceItem,
  RevenueByPeriodResult,
  BacklogItem,
  FinancialSearchCriteria,
  FinancialSearchResult,
  ClientRevenueItem,
  ReportParams,
  DateChunk,
  ReportCoverage,
  ReportRow,
  ParsedReport,
  ProjectReportBundle,
} from './quickbooks-reports.types';

@Injectable()
export class QuickbooksReportsService {
  constructor(
    private readonly operationalService: QuickbooksReportsOperationalService,
    private readonly financialService: QuickbooksReportsFinancialService,
    private readonly bundleService: QuickbooksReportsBundleService,
  ) {}

  async getAgingReport(realmId?: string): Promise<AgingReport> {
    return this.operationalService.getAgingReport(realmId);
  }

  async getOutstandingBalances(realmId?: string): Promise<OutstandingBalanceItem[]> {
    return this.operationalService.getOutstandingBalances(realmId);
  }

  async getUnbilledCompletedWork(realmId?: string): Promise<BacklogItem[]> {
    return this.operationalService.getBacklog(realmId);
  }

  async getRevenueByPeriod(
    start: string,
    end: string,
    realmId?: string,
  ): Promise<RevenueByPeriodResult> {
    return this.operationalService.getRevenueByPeriod(start, end, realmId);
  }

  async getBacklog(realmId?: string): Promise<BacklogItem[]> {
    return this.operationalService.getBacklog(realmId);
  }

  async searchByFinancialCriteria(
    criteria: FinancialSearchCriteria,
    realmId?: string,
  ): Promise<FinancialSearchResult[]> {
    return this.operationalService.searchByFinancialCriteria(criteria, realmId);
  }

  async getTopClientsByRevenue(
    limit: number = 10,
    realmId?: string,
  ): Promise<ClientRevenueItem[]> {
    return this.operationalService.getTopClientsByRevenue(limit, realmId);
  }

  async getProfitAndLossDetail(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getProfitAndLossDetail(params);
  }

  async getCashFlow(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getCashFlow(params);
  }

  async getVendorExpenses(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getVendorExpenses(params);
  }

  async getVendorBalance(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getVendorBalance(params);
  }

  async getVendorBalanceDetail(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getVendorBalanceDetail(params);
  }

  async getAgedPayables(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getAgedPayables(params);
  }

  async getAgedPayableDetail(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getAgedPayableDetail(params);
  }

  async getGeneralLedgerDetail(params: ReportParams): Promise<ParsedReport> {
    return this.financialService.getGeneralLedgerDetail(params);
  }

  async getProjectReportBundle(params: ReportParams): Promise<ProjectReportBundle> {
    return this.bundleService.getProjectReportBundle(params);
  }
}

