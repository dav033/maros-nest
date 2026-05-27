import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AnalyticsFinancialService } from './services/analytics-financial.service';
import { AnalyticsOverviewService } from './services/analytics-overview.service';
import { AnalyticsPipelineService } from './services/analytics-pipeline.service';
import { AnalyticsProjectsService } from './services/analytics-projects.service';
import { QuickbooksApiService } from '../quickbooks/services/core/quickbooks-api.service';
import { DateRangeQueryDto } from './dto/queries/date-range-query.dto';
import { RevenueTrendQueryDto } from './dto/queries/revenue-trend-query.dto';
import { TopClientsQueryDto } from './dto/queries/top-clients-query.dto';
import { LeadTypeQueryDto } from './dto/queries/lead-type-query.dto';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

class ListLimitQueryDto extends LeadTypeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '"limit" must be an integer' })
  @Min(1)
  @Max(500)
  limit?: number;
}

@Controller('analytics')
@UseInterceptors(CacheInterceptor)
export class AnalyticsController {
  constructor(
    private readonly overviewService: AnalyticsOverviewService,
    private readonly pipelineService: AnalyticsPipelineService,
    private readonly financialService: AnalyticsFinancialService,
    private readonly projectsService: AnalyticsProjectsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly quickbooksApiService: QuickbooksApiService,
  ) {}

  @Get('overview')
  @CacheTTL(300)
  getOverview(@Query() query: DateRangeQueryDto) {
    return this.overviewService.getOverview({
      from: query.from,
      to: query.to,
      leadType: query.leadType,
    });
  }

  @Get('pipeline')
  @CacheTTL(300)
  getPipeline(@Query() query: LeadTypeQueryDto) {
    return this.pipelineService.getPipeline(query.leadType);
  }

  @Get('projects-status')
  @CacheTTL(300)
  getProjectsStatus(@Query() query: LeadTypeQueryDto) {
    return this.pipelineService.getProjectsStatus(query.leadType);
  }

  @Get('financial-snapshot')
  @CacheTTL(300)
  getFinancialSnapshot(@Query() query: LeadTypeQueryDto) {
    return this.financialService.getFinancialSnapshot(query.leadType);
  }

  @Get('aging')
  @CacheTTL(300)
  getAging(@Query() query: LeadTypeQueryDto) {
    return this.financialService.getAging(query.leadType);
  }

  @Get('revenue-trend')
  @CacheTTL(300)
  getRevenueTrend(@Query() query: RevenueTrendQueryDto) {
    const months = query.months ?? 12;
    return this.financialService.getRevenueTrend(months, {
      from: query.from,
      to: query.to,
      leadType: query.leadType,
    });
  }

  @Get('top-clients')
  @CacheTTL(300)
  getTopClients(@Query() query: TopClientsQueryDto) {
    const limit = query.limit ?? 5;
    const by = query.by ?? 'revenue';
    return this.financialService.getTopClients(limit, by, query.leadType);
  }

  @Get('outstanding-balances')
  @CacheTTL(300)
  getOutstandingBalances(@Query() query: ListLimitQueryDto) {
    return this.financialService.getOutstandingBalances(
      query.limit ?? 100,
      query.leadType,
    );
  }

  @Get('backlog')
  @CacheTTL(300)
  getBacklog(@Query() query: ListLimitQueryDto) {
    return this.financialService.getBacklog(query.limit ?? 100, query.leadType);
  }

  @Get('quickbooks-revenue-report')
  @CacheTTL(300)
  getQuickbooksRevenueReport(@Query() query: DateRangeQueryDto) {
    return this.financialService.getQuickbooksRevenueReport({
      from: query.from,
      to: query.to,
    });
  }

  @Get('project-financials')
  @CacheTTL(300)
  getProjectFinancials(@Query() query: ListLimitQueryDto) {
    return this.financialService.getProjectFinancials(
      query.limit ?? 200,
      query.leadType,
    );
  }

  @Get('project-health')
  @CacheTTL(300)
  getProjectHealth(@Query() query: LeadTypeQueryDto) {
    return this.projectsService.getProjectHealth(query.leadType);
  }

  @Post('refresh')
  async refresh() {
    this.quickbooksApiService.clearReadCache();
    await this.cacheManager.clear();
    return { ok: true };
  }
}
