import { Injectable } from '@nestjs/common';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import {
  AgingBucketDto,
  FinancialSnapshotDto,
} from '../dto/financial-snapshot.dto';
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
  normalizeOptionalDateRange,
  toDateString,
} from '../utils/analytics-date-range.util';
import { isActiveProjectStatus } from '../utils/active-project-status.util';

@Injectable()
export class AnalyticsFinancialService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly quickbooksReportsService: QuickbooksReportsService,
    private readonly quickbooksFinancialsService: QuickbooksFinancialsService,
  ) {}

  async getFinancialSnapshot(): Promise<FinancialSnapshotDto> {
    const projectNumbers = await this.getActiveProjectNumbers();
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

  async getAging(): Promise<AgingBucketDto[]> {
    const report = await this.quickbooksReportsService.getAgingReport();

    return [
      {
        label: 'Current',
        count: report.current.count,
        totalBalance: report.current.totalBalance,
      },
      {
        label: '1-30',
        count: report.days1to30.count,
        totalBalance: report.days1to30.totalBalance,
      },
      {
        label: '31-60',
        count: report.days31to60.count,
        totalBalance: report.days31to60.totalBalance,
      },
      {
        label: '61-90',
        count: report.days61to90.count,
        totalBalance: report.days61to90.totalBalance,
      },
      {
        label: '90+',
        count: report.over90.count,
        totalBalance: report.over90.totalBalance,
      },
    ];
  }

  async getRevenueTrend(months: number, range?: OptionalDateRange): Promise<RevenueTrendDto[]> {
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
    const monthlyRevenue = await this.quickbooksReportsService.getRevenueByMonth(
      rangeStart,
      rangeEnd,
    );
    const revenueByMonth = new Map(
      monthlyRevenue.map((item) => [item.month, Number(item.revenue) || 0]),
    );

    return requests.map(({ month }) => ({
      month,
      revenue: revenueByMonth.get(month) ?? 0,
    }));
  }

  async getTopClients(limit: number, by: 'revenue' | 'volume'): Promise<TopClientDto[]> {
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit || 5)));
    const base = await this.quickbooksReportsService.getTopClientsByRevenue(
      by === 'volume' ? Math.max(10, safeLimit * 4) : safeLimit,
    );

    const sorted = [...base].sort((a, b) => {
      if (by === 'volume') {
        return b.invoiceCount - a.invoiceCount;
      }
      return b.totalInvoiced - a.totalInvoiced;
    });

    return sorted.slice(0, safeLimit);
  }

  async getOutstandingBalances(limit: number = 100): Promise<OutstandingBalanceItem[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
    const rows = await this.quickbooksReportsService.getOutstandingBalances();

    return rows.slice(0, safeLimit);
  }

  async getBacklog(limit: number = 100): Promise<BacklogItem[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
    const rows = await this.quickbooksReportsService.getBacklog();

    return rows.slice(0, safeLimit);
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

  async getProjectFinancials(limit: number = 200): Promise<ProjectFinancials[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 200)));
    const projectNumbers = await this.getActiveProjectNumbers();

    if (!projectNumbers.length) {
      return [];
    }

    const financials = await this.quickbooksFinancialsService.getProjectFinancials(projectNumbers);

    return financials
      .filter((item) => item.found)
      .sort((a, b) => (Number(b.estimatedAmount) || 0) - (Number(a.estimatedAmount) || 0))
      .slice(0, safeLimit);
  }

  private async getActiveProjectNumbers(): Promise<string[]> {
    const projects = await this.projectsService.findAnalyticsProjectSeed(500);

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
    const ranges: Array<{ month: string; from: string; to: string }> = [];

    for (let index = months - 1; index >= 0; index -= 1) {
      const target = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const fromDate = new Date(target.getFullYear(), target.getMonth(), 1);
      const toDate = new Date(target.getFullYear(), target.getMonth() + 1, 0);

      ranges.push({
        month: `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`,
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

    const firstMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const lastMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    const ranges: Array<{ month: string; from: string; to: string }> = [];
    const cap = 36;

    for (
      let current = new Date(firstMonth);
      current <= lastMonth && ranges.length < cap;
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1)
    ) {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const start = monthStart < fromDate ? fromDate : monthStart;
      const end = monthEnd > toDate ? toDate : monthEnd;

      ranges.push({
        month: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
        from: toDateString(start),
        to: toDateString(end),
      });
    }

    return ranges;
  }

  private toDefaultRange(): DateRange {
    const now = new Date();
    const to = toDateString(now);
    const from = toDateString(new Date(now.getFullYear(), now.getMonth() - 11, 1));
    return { from, to };
  }
}
