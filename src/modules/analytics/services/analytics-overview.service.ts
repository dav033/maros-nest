import { Injectable } from '@nestjs/common';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadsService } from '../../leads/lead-management/leads.service';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import { KpiOverviewDto } from '../dto/overview.dto';
import {
  OptionalDateRange,
  buildDefaultLast12MonthsRange,
  normalizeOptionalDateRange,
} from '../utils/analytics-date-range.util';

@Injectable()
export class AnalyticsOverviewService {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly projectsService: ProjectsService,
    private readonly quickbooksReportsService: QuickbooksReportsService,
  ) {}

  async getOverview(range?: OptionalDateRange): Promise<KpiOverviewDto> {
    const [leadStatusCounts, projectsCount] = await Promise.all([
      this.leadsService.getStatusCounts(),
      this.projectsService.countAll(),
    ]);

    const totals = leadStatusCounts.reduce(
      (acc, row) => {
        acc.total += row.count;
        if (row.status === LeadStatus.WON) acc.won = row.count;
        if (row.status === LeadStatus.LOST) acc.lost = row.count;
        return acc;
      },
      { total: 0, won: 0, lost: 0 },
    );

    const { from, to } = this.resolveDateRange(range);
    const [revenue, outstanding, backlog] = await Promise.all([
      this.quickbooksReportsService.getRevenueByPeriod(from, to),
      this.quickbooksReportsService.getOutstandingBalances(),
      this.quickbooksReportsService.getBacklog(),
    ]);

    const winRateBase = totals.won + totals.lost;
    const winRate = winRateBase > 0 ? (totals.won / winRateBase) * 100 : 0;

    return {
      leadsCount: totals.total,
      projectsCount,
      wonLeadsCount: totals.won,
      lostLeadsCount: totals.lost,
      winRate,
      revenueTotal: revenue.totalRevenue,
      outstandingTotal: outstanding.reduce(
        (sum, item) => sum + (Number(item.totalOutstanding) || 0),
        0,
      ),
      backlogTotal: backlog.reduce(
        (sum, item) => sum + (Number(item.backlogAmount) || 0),
        0,
      ),
    };
  }

  private resolveDateRange(range?: OptionalDateRange): { from: string; to: string } {
    return normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();
  }
}
