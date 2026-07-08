import { Injectable, Logger } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QBO_MAX_CONCURRENCY, runWithConcurrency } from '../core/quickbooks-concurrency.utils';
import { QuickbooksReportsContextService } from './quickbooks-reports.context.service';
import {
  ParsedReport,
  ReportCoverage,
  DateChunk,
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
  private readonly logger = new Logger(QuickbooksReportsFinancialService.name);

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

  async getBalanceSheet(params: ReportParams): Promise<ParsedReport> {
    const rid = await this.contextService.resolveRealmId(params.realmId);
    // BalanceSheet is a point-in-time report: it uses report_date (endDate),
    // not a date range. supportsDateRange = false handles that below.
    return this.fetchAndParseReport(rid, 'BalanceSheet', params, {
      accounting_method: params.accountingMethod,
    }, false);
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

    const chunkResults = await runWithConcurrency(
      coverage.dateChunks.map(
        (chunk) => () => this.fetchReportChunk(rid, qboReportName, chunk, cleaned),
      ),
      QBO_MAX_CONCURRENCY,
    );

    for (const result of chunkResults) {
      if (result.error) {
        this.logger.warn(
          `QBO report ${qboReportName} chunk ${result.chunk.start}..${result.chunk.end} failed: ${result.error.message}`,
        );
        continue;
      }
      allRows.push(...parseQboReportRows(qboReportName, result.raw));
      if (include) rawChunks.push(result.raw);
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

  private async fetchReportChunk(
    rid: string,
    qboReportName: string,
    chunk: DateChunk,
    qboParams: Record<string, string | number>,
  ): Promise<{ chunk: DateChunk; raw: unknown; error?: Error }> {
    try {
      const raw = await this.apiService.report(rid, qboReportName, {
        start_date: chunk.start,
        end_date: chunk.end,
        ...qboParams,
      });
      return { chunk, raw };
    } catch (error) {
      return {
        chunk,
        raw: {},
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private cleanQboParams(
    params: Record<string, string | number | undefined>,
  ): Record<string, string | number> {
    return Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number>;
  }
}

