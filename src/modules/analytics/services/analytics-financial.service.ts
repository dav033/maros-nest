import { Injectable } from '@nestjs/common';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import {
  AgingBucketDto,
  FinancialSnapshotDto,
} from '../dto/financial-snapshot.dto';
import { CashPositionDto } from '../dto/cash-position.dto';
import { RevenueTrendDto, TopClientDto } from '../dto/revenue-trend.dto';
import {
  AgingBucket,
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

  async getAging(leadType?: LeadType): Promise<AgingBucketDto[]> {
    const report = await this.quickbooksReportsService.getAgingReport();
    const filterBucket = (bucket: AgingBucket) => {
      if (!leadType) {
        return { count: bucket.count, totalBalance: bucket.totalBalance };
      }
      const invoices = bucket.invoices.filter((inv) =>
        matchesLeadType(inv.projectNumber, leadType),
      );
      return {
        count: invoices.length,
        totalBalance: invoices.reduce(
          (sum, inv) => sum + (Number(inv.balance) || 0),
          0,
        ),
      };
    };

    return [
      { label: 'Current', ...filterBucket(report.current) },
      { label: '1-30', ...filterBucket(report.days1to30) },
      { label: '31-60', ...filterBucket(report.days31to60) },
      { label: '61-90', ...filterBucket(report.days61to90) },
      { label: '90+', ...filterBucket(report.over90) },
    ];
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

  async getCashPosition(range?: OptionalDateRange): Promise<CashPositionDto> {
    const period =
      normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();

    // "Cash position" = el dinero real que la empresa tiene ahora en sus
    // cuentas bancarias. La fuente correcta es el Balance Sheet (Total Bank
    // Accounts), NO el Statement of Cash Flows. El Balance Sheet es un reporte
    // puntual: se evalúa a la fecha final del período (report_date = period.to).
    const report = await this.quickbooksReportsService.getBalanceSheet({
      startDate: period.from,
      endDate: period.to,
    });

    const cash = this.extractCashPosition(report);

    return {
      cashPosition: cash ?? 0,
      cashAtEnd: cash,
      netCash: null,
      period,
    };
  }

  /**
   * Extrae el "cash position" del Balance Sheet de QBO.
   * Prioriza la cuenta operativa principal "BUS COMPLETE CHK" (el dinero que
   * la empresa considera disponible ahora). Si no se encuentra, cae a la fila
   * resumen "Total Bank Accounts" y, por último, a la suma de las cuentas
   * bancarias hoja (ASSETS > Current Assets > Bank Accounts).
   */
  private extractCashPosition(report: ParsedReport): number | null {
    const isBankSection = (section: string) =>
      section.trim().toLowerCase() === 'bank accounts';

    const busComplete = report.rows.find(
      (row) =>
        isBankSection(row.section) &&
        row.label.trim().toLowerCase().includes('bus complete'),
    );
    if (busComplete) {
      return Number(busComplete.amount) || 0;
    }

    const totalRow = report.rows.find(
      (row) => row.label.trim().toLowerCase() === 'total bank accounts',
    );
    if (totalRow) {
      return Number(totalRow.amount) || 0;
    }

    const bankRows = report.rows.filter(
      (row) =>
        isBankSection(row.section) &&
        !row.label.trim().toLowerCase().startsWith('total'),
    );
    if (bankRows.length > 0) {
      return bankRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    }

    return null;
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
