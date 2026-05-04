import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksReportsContextService } from './quickbooks-reports.context.service';
import {
  ParsedReport,
  ReportCoverage,
  ReportParams,
  ReportRow,
} from './quickbooks-reports.types';
import {
  buildReportSummary,
  parseQboReportRows,
  splitDateRange,
} from './quickbooks-reports.parser';

@Injectable()
export class QuickbooksReportsFinancialService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly contextService: QuickbooksReportsContextService,
  ) {}

  async getProfitAndLoss(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'ProfitAndLoss', params, {
      accounting_method: params.accountingMethod,
      ...(params.customerId && { customer: params.customerId }),
      ...(params.summarizeColumnBy && {
        summarize_column_by: params.summarizeColumnBy,
      }),
    }, true);
  }

  async getProfitAndLossDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'ProfitAndLossDetail', params, {
      accounting_method: params.accountingMethod,
      ...(params.customerId && { customer: params.customerId }),
      ...(params.summarizeColumnBy && {
        summarize_column_by: params.summarizeColumnBy,
      }),
    }, true);
  }

  async getCashFlow(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'CashFlow', params, {
      accounting_method: params.accountingMethod,
      ...(params.summarizeColumnBy && {
        summarize_column_by: params.summarizeColumnBy,
      }),
    }, true);
  }

  async getVendorExpenses(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'VendorExpenses', params, {
      accounting_method: params.accountingMethod,
      ...(params.vendorId && { vendor: params.vendorId }),
    }, true);
  }

  async getVendorBalance(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'VendorBalance', params, {
      ...(params.vendorId && { vendor: params.vendorId }),
    }, false);
  }

  async getVendorBalanceDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'VendorBalanceDetail', params, {
      accounting_method: params.accountingMethod,
      ...(params.vendorId && { vendor: params.vendorId }),
    }, true);
  }

  async getAgedPayables(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'AgedPayables', params, {
      ...(params.vendorId && { vendor: params.vendorId }),
    }, false);
  }

  async getAgedPayableDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'AgedPayableDetail', params, {
      ...(params.vendorId && { vendor: params.vendorId }),
    }, false);
  }

  async getGeneralLedgerDetail(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    return this.fetchAndParseReport(rid, 'GeneralLedger', params, {
      accounting_method: params.accountingMethod,
      ...(params.customerId && { customer: params.customerId }),
      ...(params.vendorId && { vendor: params.vendorId }),
    }, true);
  }

  buildCoverage(params: ReportParams): ReportCoverage {
    return {
      start: params.startDate,
      end: params.endDate,
      dateChunks: splitDateRange(params.startDate, params.endDate),
    };
  }

  emptyParsedReport(reportName: string, params: ReportParams): ParsedReport {
    return {
      reportName,
      rows: [],
      summary: {},
      coverage: this.buildCoverage(params),
    };
  }

  private async fetchAndParseReport(
    rid: string,
    qboReportName: string,
    params: ReportParams,
    qboParams: Record<string, string | number | undefined>,
    supportsDateRange: boolean,
  ): Promise<ParsedReport> {
    const coverage = this.buildCoverage(params);
    const include = params.includeRaw === true;
    const cleaned = this.cleanQboParams(qboParams);

    if (!supportsDateRange) {
      const raw = await this.apiService.report(rid, qboReportName, {
        report_date: params.endDate,
        ...cleaned,
      });
      const rows = parseQboReportRows(qboReportName, raw);
      return {
        reportName: qboReportName,
        rows,
        summary: buildReportSummary(rows),
        coverage,
        ...(include ? { raw } : {}),
      };
    }

    const allRows: ReportRow[] = [];
    const rawChunks: unknown[] = [];

    for (const chunk of coverage.dateChunks) {
      const raw = await this.apiService.report(rid, qboReportName, {
        start_date: chunk.start,
        end_date: chunk.end,
        ...cleaned,
      });
      allRows.push(...parseQboReportRows(qboReportName, raw));
      if (include) rawChunks.push(raw);
    }

    return {
      reportName: qboReportName,
      rows: allRows,
      summary: buildReportSummary(allRows),
      coverage,
      ...(include
        ? { raw: rawChunks.length === 1 ? rawChunks[0] : rawChunks }
        : {}),
    };
  }

  private cleanQboParams(
    params: Record<string, string | number | undefined>,
  ): Record<string, string | number> {
    return Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number>;
  }
}

