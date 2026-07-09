import { Injectable, Logger } from '@nestjs/common';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import { FinancialSnapshotDto } from '../dto/financial-snapshot.dto';
import { ExpensesSummaryDto } from '../dto/expenses-summary.dto';
import {
  CostCategoryDto,
  CostsBreakdownDto,
} from '../dto/costs-breakdown.dto';
import { RevenueTrendDto, TopClientDto } from '../dto/revenue-trend.dto';
import {
  BacklogItem,
  OutstandingBalanceItem,
  ParsedReport,
} from '../../quickbooks/services/reports/quickbooks-reports.service';
import { ProjectFinancials } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { ProjectProfitAndLoss } from '../../quickbooks/services/financials/quickbooks-financials.types';
import {
  DateRange,
  OptionalDateRange,
  buildDefaultLast12MonthsRange,
  normalizeOptionalDateRange,
  toDateString,
} from '../utils/analytics-date-range.util';
import { isActiveProjectStatus } from '../utils/active-project-status.util';
import { matchesLeadType } from '../utils/lead-type-filter.util';
import { mapWithConcurrencyLimit } from '../utils/concurrency.util';

type AggregationResult = {
  netProfit: number;
  totalExpenses: number;
  totalCogs: number;
  categories: CostCategoryDto[];
};

type CachedAggregation = {
  value: AggregationResult;
  expiresAt: number;
};

@Injectable()
export class AnalyticsFinancialService {
  private readonly logger = new Logger(AnalyticsFinancialService.name);
  private readonly maxConcurrentQboRequests = 5;
  private readonly aggregationCacheTtlMs = 90_000;
  private readonly aggregationCache = new Map<string, CachedAggregation>();

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly quickbooksReportsService: QuickbooksReportsService,
    private readonly quickbooksFinancialsService: QuickbooksFinancialsService,
  ) {}

  /**
   * Clears the in-memory aggregation cache for per-project P&L results.
   * Called by the `POST /analytics/refresh` endpoint.
   */
  clearAggregationCache(): void {
    this.aggregationCache.clear();
  }

  /**
   * Returns a financial snapshot (estimated, invoiced, paid, outstanding)
   * aggregated across active projects, optionally filtered by lead type.
   *
   * @param leadType - Optional scope filter (Construction, Plumbing, Roofing).
   * @returns Aggregated financial snapshot DTO.
   */
  async getFinancialSnapshot(leadType?: LeadType): Promise<FinancialSnapshotDto> {
    const projectNumbers = await this.getActiveProjectNumbers(leadType);
    if (projectNumbers.length === 0) {
      return {
        projectCount: 0,
        estimatedTotal: 0,
        invoicedTotal: 0,
        paidTotal: 0,
        outstandingTotal: 0,
      };
    }

    const financials = await this.quickbooksFinancialsService.getProjectFinancials(
      projectNumbers,
    );

    return {
      projectCount: financials.length,
      estimatedTotal: this.sumByKey(financials, 'estimatedAmount'),
      invoicedTotal: this.sumByKey(financials, 'invoicedAmount'),
      paidTotal: this.sumByKey(financials, 'paidAmount'),
      outstandingTotal: this.sumByKey(financials, 'outstandingAmount'),
    };
  }

  /**
   * Returns monthly revenue trend data for the requested period.
   *
   * When a `leadType` is provided, revenue is filtered from individual
   * payment records matching the scope. Otherwise, the company-wide
   * monthly revenue report is used.
   *
   * @param months  - Number of trailing months (capped 1–24, default 12).
   * @param range   - Optional explicit date range and lead type filter.
   * @returns Array of { month, revenue } points.
   */
  async getRevenueTrend(
    months: number,
    range?: OptionalDateRange & { leadType?: LeadType },
  ): Promise<RevenueTrendDto[]> {
    const normalizedRange = normalizeOptionalDateRange(range);
    const safeMonths = Number.isFinite(months)
      ? Math.max(1, Math.min(24, Math.trunc(months)))
      : 12;

    const requests = this.buildMonthRanges(safeMonths, normalizedRange);
    if (requests.length === 0) {
      return [];
    }

    const rangeStart = requests[0].from;
    const rangeEnd = requests[requests.length - 1].to;
    const revenueByMonth = new Map<string, number>();

    if (range?.leadType) {
      const payments = await this.quickbooksReportsService.getRevenuePayments(
        rangeStart,
        rangeEnd,
      );
      for (const payment of payments) {
        if (!matchesLeadType(payment.projectNumber, range.leadType)) {
          continue;
        }
        revenueByMonth.set(
          payment.month,
          (revenueByMonth.get(payment.month) ?? 0) + (Number(payment.amount) || 0),
        );
      }
    } else {
      const monthlyRevenue = await this.quickbooksReportsService.getRevenueByMonth(
        rangeStart,
        rangeEnd,
      );
      for (const item of monthlyRevenue) {
        revenueByMonth.set(item.month, Number(item.revenue) || 0);
      }
    }

    return requests.map(({ month }) => ({
      month,
      revenue: revenueByMonth.get(month) ?? 0,
    }));
  }

  /**
   * Returns the top clients sorted by revenue or invoice volume,
   * optionally filtered by lead type.
   *
   * @param limit    - Max results (capped 1–20, default 5).
   * @param by       - Sort criterion: 'revenue' | 'volume'.
   * @param leadType - Optional scope filter.
   * @returns Array of top client DTOs.
   */
  async getTopClients(
    limit: number,
    by: 'revenue' | 'volume',
    leadType?: LeadType,
  ): Promise<TopClientDto[]> {
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit || 5)));
    const fetchSize = leadType
      ? Math.max(50, safeLimit * 10)
      : by === 'volume'
        ? Math.max(10, safeLimit * 4)
        : safeLimit;
    const base = await this.quickbooksReportsService.getTopClientsByRevenue(fetchSize);

    const filtered = leadType
      ? base.filter((item) => matchesLeadType(item.projectNumber, leadType))
      : base;

    const sorted = [...filtered].sort((a, b) => {
      if (by === 'volume') {
        return b.invoiceCount - a.invoiceCount;
      }
      return b.totalInvoiced - a.totalInvoiced;
    });

    return sorted.slice(0, safeLimit);
  }

  /**
   * Returns outstanding AR balances, optionally filtered by lead type.
   *
   * @param limit    - Max items (capped 1–500, default 100).
   * @param leadType - Optional scope filter.
   * @returns Array of outstanding balance items.
   */
  async getOutstandingBalances(
    limit: number = 100,
    leadType?: LeadType,
  ): Promise<OutstandingBalanceItem[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
    const rows = await this.quickbooksReportsService.getOutstandingBalances();
    const filtered = leadType
      ? rows.filter((row) => matchesLeadType(row.projectNumber, leadType))
      : rows;

    return filtered.slice(0, safeLimit);
  }

  /**
   * Returns backlog items (estimated vs invoiced), optionally filtered by lead type.
   *
   * @param limit    - Max items (capped 1–500, default 100).
   * @param leadType - Optional scope filter.
   * @returns Array of backlog items.
   */
  async getBacklog(limit: number = 100, leadType?: LeadType): Promise<BacklogItem[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
    const rows = await this.quickbooksReportsService.getBacklog();
    const filtered = leadType
      ? rows.filter((row) => matchesLeadType(row.projectNumber, leadType))
      : rows;

    return filtered.slice(0, safeLimit);
  }

  /**
   * Calculates total accrued revenue (income) for the given period.
   *
   * For General scope (no leadType), reads the company-wide Accrual P&L.
   * For a specific scope, sums individual invoice amounts matching the lead type.
   *
   * @param range    - Date range { from, to } in YYYY-MM-DD format.
   * @param leadType - Optional scope filter.
   * @returns Total accrued revenue amount.
   */
  async getRevenueAccrual(
    range: { from: string; to: string },
    leadType?: LeadType,
  ): Promise<number> {
    if (leadType) {
      const invoices = await this.quickbooksReportsService.getInvoicesByPeriod(
        range.from,
        range.to,
      );
      return invoices
        .filter((item) => matchesLeadType(item.projectNumber, leadType))
        .reduce((sum, item) => sum + item.amount, 0);
    }

    const report = await this.quickbooksReportsService.getProfitAndLoss({
      startDate: range.from,
      endDate: range.to,
      accountingMethod: 'Accrual',
    });

    let totalIncome = 0;
    for (const row of report.rows) {
      const section = row.section.toLowerCase();
      const label = row.label.toLowerCase().trim();
      if (section === 'income' && /^total(\s+for)?\s+income$/.test(label)) {
        totalIncome += row.amount;
      }
    }

    return totalIncome;
  }

  /**
   * Calculates total cash-basis revenue (payments received) for the given period.
   *
   * For General scope (no leadType), reads the company-wide Cash P&L.
   * For a specific scope, sums individual payment records matching the lead type.
   *
   * @param range    - Date range { from, to } in YYYY-MM-DD format.
   * @param leadType - Optional scope filter.
   * @returns Total cash revenue amount.
   */
  async getRevenueCash(
    range: { from: string; to: string },
    leadType?: LeadType,
  ): Promise<number> {
    if (leadType) {
      const payments = await this.quickbooksReportsService.getRevenuePayments(
        range.from,
        range.to,
      );
      return payments
        .filter((item) => matchesLeadType(item.projectNumber, leadType))
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    }

    const report = await this.quickbooksReportsService.getProfitAndLoss({
      startDate: range.from,
      endDate: range.to,
      accountingMethod: 'Cash',
    });

    let totalIncome = 0;
    for (const row of report.rows) {
      const section = row.section.toLowerCase();
      const label = row.label.toLowerCase().trim();
      if (section === 'income' && /^total(\s+for)?\s+income$/.test(label)) {
        totalIncome += row.amount;
      }
    }

    return totalIncome;
  }

  /**
   * Returns the **profit (Net Income)** for the given period and scope.
   *
   * **Scope behavior:**
   * - **General** (no `leadType`): reads the company-wide Cash P&L from QBO and
   *   extracts the Net Income line.
   * - **Construction / Plumbing / Roofing**: aggregates project-level P&Ls
   *   (cash basis) for all active projects in that scope, summing their
   *   `netProfit` fields. Uses concurrency-limited parallel requests,
   *   `Promise.allSettled` error handling, and an in-memory cache with TTL.
   *
   * @param range    - Date range { from, to } in YYYY-MM-DD format.
   * @param leadType - Optional scope. If omitted, company-wide P&L is used.
   * @returns Net profit amount.
   */
  async getProfit(
    range: { from: string; to: string },
    leadType?: LeadType,
  ): Promise<number> {
    if (leadType) {
      const aggregated = await this.aggregateProjectProfitAndLoss(leadType, range);
      return aggregated.netProfit;
    }

    const report = await this.quickbooksReportsService.getProfitAndLoss({
      startDate: range.from,
      endDate: range.to,
      accountingMethod: 'Cash',
    });

    return this.extractNetIncome(report);
  }

  /**
   * Returns a summary of total expenses and COGS for the given period.
   *
   * **Scope behavior:**
   * - **General** (no `leadType`): reads the company-wide Cash P&L from QBO.
   * - **Construction / Plumbing / Roofing**: aggregates project-level P&Ls
   *   for all active projects in that scope (same concurrency + cache strategy
   *   as `getProfit`).
   *
   * @param range    - Optional date range (defaults to last 12 months).
   * @param leadType - Optional scope filter.
   * @returns Expenses summary with totalExpenses, totalCogs, and period.
   */
  async getExpensesSummary(
    range?: OptionalDateRange,
    leadType?: LeadType,
  ): Promise<ExpensesSummaryDto> {
    const period =
      normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();

    if (leadType) {
      const aggregated = await this.aggregateProjectProfitAndLoss(leadType, period);
      return {
        totalExpenses: aggregated.totalExpenses,
        totalCogs: aggregated.totalCogs,
        period,
      };
    }

    // Cash basis para ser consistente con el KPI de Revenue del dashboard
    // (getRevenueCash), que también sale del P&L en base Cash.
    const report = await this.quickbooksReportsService.getProfitAndLoss({
      startDate: period.from,
      endDate: period.to,
      accountingMethod: 'Cash',
    });

    return {
      totalExpenses: this.extractSectionTotal(report, 'expenses'),
      totalCogs: this.extractSectionTotal(report, 'cost of goods sold'),
      period,
    };
  }

  /**
   * Returns a detailed breakdown of all costs (Expenses + COGS) by category.
   *
   * **Scope behavior:**
   * - **General** (no `leadType`): parses the company-wide Cash P&L from QBO
   *   and extracts individual account lines under "Expenses" and "Cost of Goods Sold".
   * - **Construction / Plumbing / Roofing**: aggregates project-level P&Ls
   *   for all active projects in that scope (same concurrency + cache strategy
   *   as `getProfit`). Categories from each project are merged and summed.
   *
   * Consistent with `getExpensesSummary`.
   *
   * @param range    - Optional date range (defaults to last 12 months).
   * @param leadType - Optional scope filter.
   * @returns Costs breakdown with totalCosts, totalExpenses, totalCogs,
   *          per-category detail, and period.
   */
  async getCostsBreakdown(
    range?: OptionalDateRange,
    leadType?: LeadType,
  ): Promise<CostsBreakdownDto> {
    const period =
      normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();

    if (leadType) {
      const aggregated = await this.aggregateProjectProfitAndLoss(leadType, period);
      const totalExpenses = aggregated.totalExpenses;
      const totalCogs = aggregated.totalCogs;
      const categories = aggregated.categories
        .filter((item) => item.amount !== 0)
        .sort((a, b) => b.amount - a.amount);

      return {
        totalCosts: totalExpenses + totalCogs,
        totalExpenses,
        totalCogs,
        categories,
        period,
      };
    }

    const report = await this.quickbooksReportsService.getProfitAndLoss({
      startDate: period.from,
      endDate: period.to,
      accountingMethod: 'Cash',
    });

    const sectionByRoot: Record<string, CostCategoryDto['section']> = {
      expenses: 'EXPENSES',
      'cost of goods sold': 'COGS',
    };

    const amounts = new Map<string, CostCategoryDto>();
    for (const row of report.rows) {
      const root = row.path[0]?.trim().toLowerCase() ?? '';
      const section = sectionByRoot[root];
      const label = row.label.trim();
      // Solo filas de cuenta (hoja); las filas "Total [for] ..." son resúmenes
      // de sección y sumarlas duplicaría los montos.
      if (!section || !label || /^total(\s|$)/i.test(label)) {
        continue;
      }
      const key = `${section}:${label}`;
      const existing = amounts.get(key);
      if (existing) {
        existing.amount += row.amount;
      } else {
        amounts.set(key, { category: label, section, amount: row.amount });
      }
    }

    const totalExpenses = this.extractSectionTotal(report, 'expenses');
    const totalCogs = this.extractSectionTotal(report, 'cost of goods sold');

    const categories = [...amounts.values()]
      .filter((item) => item.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

    return {
      totalCosts: totalExpenses + totalCogs,
      totalExpenses,
      totalCogs,
      categories,
      period,
    };
  }

  /**
   * Suma las filas resumen "Total [for] <section>" del P&L de QBO
   * (p. ej. "Total for Expenses", "Total for Cost of Goods Sold").
   */
  private extractSectionTotal(report: ParsedReport, sectionName: string): number {
    const totalLabel = new RegExp(`^total(\\s+for)?\\s+${sectionName}$`);
    let total = 0;
    for (const row of report.rows) {
      const section = row.section.trim().toLowerCase();
      const label = row.label.trim().toLowerCase();
      if (section === sectionName && totalLabel.test(label)) {
        total += row.amount;
      }
    }
    return total;
  }

  /**
   * Extrae el Net Income total del P&L de QBO.
   *
   * Prefiere la fila cuya sección sea "Net Income" (el resumen final del
   * reporte). Si no existe, cae en el último match por etiqueta "net income",
   * evitando sumar filas duplicadas.
   */
  private extractNetIncome(report: ParsedReport): number {
    let fallbackAmount = 0;
    let fallbackFound = false;

    for (const row of report.rows) {
      const section = row.section.trim().toLowerCase();
      const label = row.label.trim().toLowerCase();

      if (section === 'net income') {
        return row.amount;
      }

      if (label === 'net income') {
        fallbackAmount = row.amount;
        fallbackFound = true;
      }
    }

    return fallbackFound ? fallbackAmount : 0;
  }

  /**
   * Agrega los P&L a nivel proyecto para los proyectos activos de un leadType.
   * Se usa en cash basis para mantener consistencia con los KPIs financieros
   * generales.
   *
   * - Limita la concurrencia de llamadas a QBO.
   * - Usa Promise.allSettled para no tumbar toda la agregación por un solo fallo.
   * - Cachea el resultado por (leadType, from, to) por un TTL corto.
   */
  private async aggregateProjectProfitAndLoss(
    leadType: LeadType,
    range: { from: string; to: string },
  ): Promise<AggregationResult> {
    const cacheKey = `${leadType}:${range.from}:${range.to}`;
    const cached = this.aggregationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const projectNumbers = await this.getActiveProjectNumbers(leadType);
    if (projectNumbers.length === 0) {
      this.logger.warn(`aggregateProjectProfitAndLoss: no active projects found for leadType=${leadType}`);
      return { netProfit: 0, totalExpenses: 0, totalCogs: 0, categories: [] };
    }

    this.logger.log(`aggregateProjectProfitAndLoss: ${projectNumbers.length} active projects for ${leadType}`);

    const rangeParams = { startDate: range.from, endDate: range.to };
    const settled = await mapWithConcurrencyLimit(
      projectNumbers,
      this.maxConcurrentQboRequests,
      (projectNumber) =>
        Promise.allSettled([
          this.quickbooksFinancialsService.getProjectProfitAndLoss(
            projectNumber,
            undefined,
            rangeParams,
            'Cash',
          ),
        ]).then(([result]): [string, PromiseSettledResult<ProjectProfitAndLoss>] => [
          projectNumber,
          result,
        ]),
    );

    let netProfit = 0;
    let totalExpenses = 0;
    let totalCogs = 0;
    const categoryAmounts = new Map<string, CostCategoryDto>();
    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    for (const [projectNumber, result] of settled) {
      if (result.status === 'rejected') {
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.warn(`Skipping project ${projectNumber} P&L due to QBO error: ${message}`);
        errorCount += 1;
        continue;
      }

      const report = result.value;
      if (!report.found) {
        this.logger.debug(`Project ${projectNumber} P&L not found in QBO (no matching job)`);
        notFoundCount += 1;
        continue;
      }
      successCount += 1;
      netProfit += Number(report.netProfit) || 0;
      totalExpenses += Number(report.expenses.total) || 0;
      totalCogs += Number(report.costOfGoodsSold.total) || 0;

      for (const category of report.expenses.categories) {
        const key = `EXPENSES:${category.name}`;
        const existing = categoryAmounts.get(key);
        if (existing) {
          existing.amount += Number(category.amount) || 0;
        } else {
          categoryAmounts.set(key, {
            category: category.name,
            section: 'EXPENSES',
            amount: Number(category.amount) || 0,
          });
        }
      }

      for (const category of report.costOfGoodsSold.categories) {
        const key = `COGS:${category.name}`;
        const existing = categoryAmounts.get(key);
        if (existing) {
          existing.amount += Number(category.amount) || 0;
        } else {
          categoryAmounts.set(key, {
            category: category.name,
            section: 'COGS',
            amount: Number(category.amount) || 0,
          });
        }
      }
    }

    this.logger.log(
      `aggregateProjectProfitAndLoss(${leadType}): ${successCount} succeeded, ${notFoundCount} not found, ${errorCount} errors. netProfit=${netProfit}`,
    );

    const value: AggregationResult = {
      netProfit,
      totalExpenses,
      totalCogs,
      categories: [...categoryAmounts.values()],
    };
    this.evictExpiredAggregationCacheEntries();
    this.aggregationCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.aggregationCacheTtlMs,
    });

    return value;
  }

  /**
   * Fetches the detailed QBO P&L report (Accrual basis) for the given period.
   *
   * @param range - Optional date range (defaults to last 12 months).
   * @returns Parsed QBO profit and loss detail report.
   */
  async getQuickbooksRevenueReport(range?: OptionalDateRange): Promise<ParsedReport> {
    const normalizedRange = normalizeOptionalDateRange(range) ?? {
      from: this.toDefaultRange().from,
      to: this.toDefaultRange().to,
    };

    return this.quickbooksReportsService.getProfitAndLossDetail({
      startDate: normalizedRange.from,
      endDate: normalizedRange.to,
      accountingMethod: 'Accrual',
    });
  }

  /**
   * Returns financial details (estimated, invoiced, paid, outstanding) for
   * active projects, optionally filtered by lead type, sorted by estimated
   * amount descending.
   *
   * @param limit    - Max results (capped 1–500, default 200).
   * @param leadType - Optional scope filter.
   * @returns Array of project financial items.
   */
  async getProjectFinancials(
    limit: number = 200,
    leadType?: LeadType,
  ): Promise<ProjectFinancials[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 200)));
    const projectNumbers = await this.getActiveProjectNumbers(leadType);

    if (!projectNumbers.length) {
      return [];
    }

    const financials = await this.quickbooksFinancialsService.getProjectFinancials(projectNumbers);

    return financials
      .filter((item) => item.found)
      .sort((a, b) => (Number(b.estimatedAmount) || 0) - (Number(a.estimatedAmount) || 0))
      .slice(0, safeLimit);
  }

  private async getActiveProjectNumbers(leadType?: LeadType): Promise<string[]> {
    const projects = await this.projectsService.findAnalyticsProjectSeed(500, leadType);

    return projects
      .filter((project) => isActiveProjectStatus(project.projectProgressStatus))
      .map((project) => project.leadNumber)
      .filter((leadNumber): leadNumber is string => Boolean(leadNumber));
  }

  private sumByKey<T, K extends keyof T>(items: T[], key: K): number {
    return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
  }

  private buildMonthRanges(
    months: number,
    range?: DateRange,
  ): Array<{ month: string; from: string; to: string }> {
    const rangeMonths = this.buildRangesFromDateFilter(range);
    if (rangeMonths.length > 0) {
      return rangeMonths;
    }

    const now = new Date();
    const baseYear = now.getUTCFullYear();
    const baseMonth = now.getUTCMonth();
    const ranges: Array<{ month: string; from: string; to: string }> = [];

    for (let index = months - 1; index >= 0; index -= 1) {
      const targetYear = baseYear;
      const targetMonth = baseMonth - index;
      const fromDate = new Date(Date.UTC(targetYear, targetMonth, 1));
      const toDate = new Date(Date.UTC(targetYear, targetMonth + 1, 0));

      ranges.push({
        month: `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, '0')}`,
        from: toDateString(fromDate),
        to: toDateString(toDate),
      });
    }

    return ranges;
  }

  private buildRangesFromDateFilter(range?: DateRange): Array<{ month: string; from: string; to: string }> {
    if (!range?.from || !range?.to) {
      return [];
    }

    const fromDate = new Date(`${range.from}T00:00:00.000Z`);
    const toDate = new Date(`${range.to}T00:00:00.000Z`);

    const firstMonth = new Date(
      Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1),
    );
    const lastMonth = new Date(
      Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), 1),
    );
    const ranges: Array<{ month: string; from: string; to: string }> = [];
    const cap = 36;

    for (
      let current = new Date(firstMonth);
      current <= lastMonth && ranges.length < cap;
      current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1))
    ) {
      const monthStart = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1),
      );
      const monthEnd = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
      );
      const start = monthStart < fromDate ? fromDate : monthStart;
      const end = monthEnd > toDate ? toDate : monthEnd;

      ranges.push({
        month: `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`,
        from: toDateString(start),
        to: toDateString(end),
      });
    }

    return ranges;
  }

  private toDefaultRange(): DateRange {
    return buildDefaultLast12MonthsRange();
  }

  private evictExpiredAggregationCacheEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.aggregationCache.entries()) {
      if (entry.expiresAt <= now) {
        this.aggregationCache.delete(key);
      }
    }
  }
}
