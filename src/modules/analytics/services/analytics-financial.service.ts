import { Injectable } from '@nestjs/common';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import {
  AgingBucketDto,
  FinancialSnapshotDto,
} from '../dto/financial-snapshot.dto';
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
