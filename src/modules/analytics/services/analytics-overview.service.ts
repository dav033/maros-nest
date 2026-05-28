import { Injectable } from '@nestjs/common';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { LeadsService } from '../../leads/lead-management/leads.service';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import { AnalyticsFinancialService } from './analytics-financial.service';
import { KpiOverviewDto } from '../dto/overview.dto';
import {
  OptionalDateRange,
  buildDefaultLast12MonthsRange,
  normalizeOptionalDateRange,
} from '../utils/analytics-date-range.util';
import { matchesLeadType } from '../utils/lead-type-filter.util';

export type OverviewParams = OptionalDateRange & {
  leadType?: LeadType;
};

@Injectable()
export class AnalyticsOverviewService {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly projectsService: ProjectsService,
    private readonly quickbooksReportsService: QuickbooksReportsService,
    private readonly financialService: AnalyticsFinancialService,
  ) {}

  async getOverview(params?: OverviewParams): Promise<KpiOverviewDto> {
    const leadType = params?.leadType;
    const [leadStatusCounts, projectsCount] = await Promise.all([
      this.leadsService.getStatusCounts(leadType),
      this.projectsService.countAll(leadType),
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

    const { from, to } = this.resolveDateRange(params);
    const [revenueTotal, revenuePipelineTotal, outstanding, backlog] = await Promise.all([
      this.financialService.getRevenueAccrual({ from, to }, leadType),
      this.financialService.getRevenueCash({ from, to }, leadType),
      this.quickbooksReportsService.getOutstandingBalances(),
      this.quickbooksReportsService.getBacklog(),
    ]);

    const winRateBase = totals.won + totals.lost;
    const winRate = winRateBase > 0 ? (totals.won / winRateBase) * 100 : 0;

    const outstandingTotal = outstanding
      .filter((item) => matchesLeadType(item.projectNumber, leadType))
      .reduce((sum, item) => sum + (Number(item.totalOutstanding) || 0), 0);
    const backlogTotal = backlog
      .filter((item) => matchesLeadType(item.projectNumber, leadType))
      .reduce((sum, item) => sum + (Number(item.backlogAmount) || 0), 0);

    return {
      leadsCount: totals.total,
      projectsCount,
      wonLeadsCount: totals.won,
      lostLeadsCount: totals.lost,
      winRate,
      revenueTotal,
      outstandingTotal,
      backlogTotal,
      revenuePipelineTotal,
    };
  }

  private resolveDateRange(range?: OptionalDateRange): { from: string; to: string } {
    return normalizeOptionalDateRange(range) ?? buildDefaultLast12MonthsRange();
  }
}
