import { Injectable, Logger } from '@nestjs/common';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { LeadsService } from '../../leads/lead-management/leads.service';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { PipelineBucketDto } from '../dto/pipeline.dto';
import { ProjectsStatusBucketDto } from '../dto/revenue-trend.dto';

@Injectable()
export class AnalyticsPipelineService {
  private readonly logger = new Logger(AnalyticsPipelineService.name);

  constructor(
    private readonly leadsService: LeadsService,
    private readonly projectsService: ProjectsService,
    private readonly quickbooksFinancialsService: QuickbooksFinancialsService,
  ) {}

  async getPipeline(leadType?: LeadType): Promise<PipelineBucketDto[]> {
    const seed = await this.leadsService.getStatusSeed(leadType);

    const counts = new Map<string, number>();
    const numbersByStatus = new Map<string, string[]>();
    for (const row of seed) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      if (row.leadNumber) {
        const list = numbersByStatus.get(row.status) ?? [];
        list.push(row.leadNumber);
        numbersByStatus.set(row.status, list);
      }
    }

    // estimatedValue viene 100% de los Estimates de QuickBooks (por leadNumber),
    // no del CRM. Si QBO no responde, el pipeline sigue funcionando con montos 0.
    const estimateByNumber = new Map<string, number>();
    const allNumbers = [...numbersByStatus.values()].flat();
    if (allNumbers.length > 0) {
      try {
        const financials =
          await this.quickbooksFinancialsService.getProjectFinancials(allNumbers);
        for (const fin of financials) {
          estimateByNumber.set(
            fin.projectNumber,
            Number(fin.estimatedAmount) || 0,
          );
        }
      } catch (error) {
        this.logger.error(
          `Could not fetch QBO estimates for pipeline: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return Object.values(LeadStatus).map((status) => {
      const numbers = numbersByStatus.get(status) ?? [];
      const estimatedValue = numbers.reduce(
        (sum, leadNumber) => sum + (estimateByNumber.get(leadNumber) ?? 0),
        0,
      );
      return {
        status,
        count: counts.get(status) ?? 0,
        estimatedValue,
      };
    });
  }

  async getProjectsStatus(
    leadType?: LeadType,
  ): Promise<ProjectsStatusBucketDto[]> {
    const rows = await this.projectsService.getStatusCounts(leadType);
    const knownStatuses = new Set(Object.values(ProjectProgressStatus));
    const byStatus = new Map<string, number>();

    for (const row of rows) {
      const raw = String(row.status ?? '').trim();
      if (!raw) continue;
      const normalized = raw.toUpperCase();
      byStatus.set(normalized, (byStatus.get(normalized) ?? 0) + (Number(row.count) || 0));
    }

    const knownBuckets = Object.values(ProjectProgressStatus).map((status) => ({
      status,
      count: byStatus.get(status) ?? 0,
    }));

    const extraBuckets = [...byStatus.entries()]
      .filter(([status, count]) => !knownStatuses.has(status as ProjectProgressStatus) && count > 0)
      .map(([status, count]) => ({ status, count }));

    return [...knownBuckets, ...extraBuckets];
  }
}
