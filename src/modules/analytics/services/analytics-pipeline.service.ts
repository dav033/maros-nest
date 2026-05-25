import { Injectable } from '@nestjs/common';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { LeadsService } from '../../leads/lead-management/leads.service';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { PipelineBucketDto } from '../dto/pipeline.dto';
import { ProjectsStatusBucketDto } from '../dto/revenue-trend.dto';

@Injectable()
export class AnalyticsPipelineService {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly projectsService: ProjectsService,
  ) {}

  async getPipeline(): Promise<PipelineBucketDto[]> {
    const rows = await this.leadsService.getStatusCounts();
    const byStatus = new Map(rows.map((row) => [row.status, row]));

    return Object.values(LeadStatus).map((status) => {
      const row = byStatus.get(status);
      return {
        status,
        count: row?.count ?? 0,
        estimatedValue: row?.estimatedValue ?? 0,
      };
    });
  }

  async getProjectsStatus(): Promise<ProjectsStatusBucketDto[]> {
    const rows = await this.projectsService.getStatusCounts();
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
