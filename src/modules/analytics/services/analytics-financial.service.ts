import { Injectable } from '@nestjs/common';
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
import {
  DateRange,
  OptionalDateRange,
  buildDefaultLast12MonthsRange,
  normalizeOptionalDateRange,
  toDateString,
} from '../utils/analytics-date-range.util';
import { isActiveProjectStatus } from '../utils/active-project-status.util';
import { matchesLeadType } from '../utils/lead-type-filter.util';

@Injectable()
export class AnalyticsFinancialService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly quickbooksReportsService: QuickbooksReportsService,
    private readonly quickbooksFinancialsService: QuickbooksFinancialsService,
  ) {}

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

  async getBacklog(limit: number = 100, leadType?: LeadType): Promise<BacklogItem[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
    const rows = await this.quickbooksReportsService.getBacklog();
    const filtered = leadType
      ? rows.filter((row) => matchesLeadType(row.projectNumber, leadType))
      : rows;

    return filtered.slice(0, safeLimit);
  }

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

  async getExpensesSummary(
    range?: OptionalDateRange,
  ): Promise<ExpensesSummaryDto> {
    const period =
      normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();

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
   * Desglose de todos los costos (Expenses + COGS) por categoría a partir
   * del P&L de QBO en base Cash, consistente con getExpensesSummary.
   */
  async getCostsBreakdown(
    range?: OptionalDateRange,
  ): Promise<CostsBreakdownDto> {
    const period =
      normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();

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
}
