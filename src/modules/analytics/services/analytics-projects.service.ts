import { Injectable, Logger } from '@nestjs/common';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksJobCostingService } from '../../quickbooks/services/job-costing/quickbooks-job-costing.service';
import { ProjectHealthDto } from '../dto/project-health.dto';
import { isActiveProjectStatus } from '../utils/active-project-status.util';

@Injectable()
export class AnalyticsProjectsService {
  private readonly logger = new Logger(AnalyticsProjectsService.name);
  private readonly maxProjectsToAnalyze = 15;
  private readonly maxConcurrentQboRequests = 3;
  private readonly lowMarginThreshold = 12;
  private readonly highBacklogThreshold = 10_000;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly quickbooksJobCostingService: QuickbooksJobCostingService,
  ) {}

  async getProjectHealth(leadType?: LeadType): Promise<ProjectHealthDto[]> {
    const projects = await this.projectsService.findAnalyticsProjectSeed(300, leadType);
    const activeProjects = projects
      .filter((project) => isActiveProjectStatus(project.projectProgressStatus))
      .filter((project) => Boolean(project.leadNumber))
      .slice(0, this.maxProjectsToAnalyze);

    const health = await this.mapWithConcurrencyLimit(
      activeProjects,
      this.maxConcurrentQboRequests,
      (project) => this.buildProjectHealth(project),
    );

    return health.filter((item): item is ProjectHealthDto => Boolean(item && item.reasons.length > 0));
  }

  private async buildProjectHealth(project: {
    id: number;
    projectProgressStatus?: ProjectProgressStatus;
    leadNumber?: string;
    leadName?: string;
  }): Promise<ProjectHealthDto | null> {
    const projectNumber = String(project.leadNumber ?? '');
    if (!projectNumber) {
      return null;
    }

    try {
      const summary = await this.quickbooksJobCostingService.getProjectJobCostSummary({
        projectNumber,
      });

      const margin = Number(summary.summary.grossMarginPercent) || 0;
      const backlog = Math.max(
        0,
        (Number(summary.summary.contractValue) || 0) -
          (Number(summary.summary.invoicedAmount) || 0),
      );
      const reasons: string[] = [];

      if (margin < this.lowMarginThreshold) {
        reasons.push(`Low margin (${margin.toFixed(1)}%)`);
      }
      if (backlog > this.highBacklogThreshold) {
        reasons.push(`High backlog (${backlog.toFixed(2)})`);
      }

      return {
        projectId: project.id,
        projectNumber,
        projectName: project.leadName ?? projectNumber,
        status: project.projectProgressStatus,
        grossMarginPercent: margin,
        backlogAmount: backlog,
        riskLevel: this.resolveRiskLevel(margin, backlog),
        reasons,
      } satisfies ProjectHealthDto;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Skipping project ${projectNumber} due to QBO error: ${message}`);
      return null;
    }
  }

  private async mapWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) return [];
    const safeLimit = Math.max(1, Math.min(limit, items.length));
    const results: R[] = [];
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        results[current] = await mapper(items[current]);
      }
    };

    await Promise.all(Array.from({ length: safeLimit }, () => worker()));
    return results;
  }

  private resolveRiskLevel(
    margin: number,
    backlog: number,
  ): 'low' | 'medium' | 'high' {
    if (margin < 8 || backlog > this.highBacklogThreshold * 2) {
      return 'high';
    }
    if (margin < this.lowMarginThreshold || backlog > this.highBacklogThreshold) {
      return 'medium';
    }
    return 'low';
  }
}
