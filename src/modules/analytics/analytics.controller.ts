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

// cache-manager v7 expects TTL in milliseconds.
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

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

  /**
   * GET /analytics/overview
   *
   * Returns aggregated dashboard KPIs including leads, projects, revenue,
   * pipeline, and profit.
   *
   * Query params (all optional):
   * - `from` / `to` — date range in YYYY-MM-DD (defaults to last 12 months).
   * - `leadType` — scope filter: CONSTRUCTION | PLUMBING | ROOFING.
   *   When omitted, company-wide (General) data is returned.
   *
   * **profit** (new): Net Income from company-wide P&L for General scope;
   * aggregated from project-level P&Ls for scoped views.
   */
  @Get('overview')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getOverview(@Query() query: DateRangeQueryDto) {
    return this.overviewService.getOverview({
      from: query.from,
      to: query.to,
      leadType: query.leadType,
    });
  }

  /**
   * GET /analytics/pipeline
   *
   * Returns lead pipeline buckets grouped by status.
   *
   * Query params (optional):
   * - `leadType` — scope filter: CONSTRUCTION | PLUMBING | ROOFING.
   */
  @Get('pipeline')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getPipeline(@Query() query: LeadTypeQueryDto) {
    return this.pipelineService.getPipeline(query.leadType);
  }

  /**
   * GET /analytics/projects-status
   *
   * Returns project counts grouped by status.
   *
   * Query params (optional):
   * - `leadType` — scope filter: CONSTRUCTION | PLUMBING | ROOFING.
   */
  @Get('projects-status')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getProjectsStatus(@Query() query: LeadTypeQueryDto) {
    return this.pipelineService.getProjectsStatus(query.leadType);
  }

  /**
   * GET /analytics/financial-snapshot
   *
   * Returns aggregated estimated, invoiced, paid, and outstanding amounts
   * across active projects.
   *
   * Query params (optional):
   * - `leadType` — scope filter: CONSTRUCTION | PLUMBING | ROOFING.
   */
  @Get('financial-snapshot')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getFinancialSnapshot(@Query() query: LeadTypeQueryDto) {
    return this.financialService.getFinancialSnapshot(query.leadType);
  }

  @Get('leads-per-month')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getLeadsPerMonth(@Query() query: RevenueTrendQueryDto) {
    const months = query.months ?? 12;
    return this.pipelineService.getLeadsPerMonth(months, {
      from: query.from,
      to: query.to,
      leadType: query.leadType,
    });
  }

  @Get('revenue-trend')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getRevenueTrend(@Query() query: RevenueTrendQueryDto) {
    const months = query.months ?? 12;
    return this.financialService.getRevenueTrend(months, {
      from: query.from,
      to: query.to,
      leadType: query.leadType,
    });
  }

  @Get('top-clients')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getTopClients(@Query() query: TopClientsQueryDto) {
    const limit = query.limit ?? 5;
    const by = query.by ?? 'revenue';
    return this.financialService.getTopClients(limit, by, query.leadType);
  }

  @Get('outstanding-balances')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getOutstandingBalances(@Query() query: ListLimitQueryDto) {
    return this.financialService.getOutstandingBalances(
      query.limit ?? 100,
      query.leadType,
    );
  }

  @Get('backlog')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getBacklog(@Query() query: ListLimitQueryDto) {
    return this.financialService.getBacklog(query.limit ?? 100, query.leadType);
  }

  /**
   * GET /analytics/expenses-summary
   *
   * Returns total expenses and COGS for the period.
   *
   * Query params (all optional):
   * - `from` / `to` — date range in YYYY-MM-DD (defaults to last 12 months).
   * - `leadType` — scope filter: CONSTRUCTION | PLUMBING | ROOFING.
   *   When omitted, company-wide data from the Cash P&L is returned.
   *   When set, aggregates project-level P&Ls for all active projects in that scope.
   */
  @Get('expenses-summary')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getExpensesSummary(@Query() query: DateRangeQueryDto) {
    return this.financialService.getExpensesSummary(
      {
        from: query.from,
        to: query.to,
      },
      query.leadType,
    );
  }

  /**
   * GET /analytics/costs-breakdown
   *
   * Returns a detailed breakdown of all costs (Expenses + COGS) by category.
   *
   * Query params (all optional):
   * - `from` / `to` — date range in YYYY-MM-DD (defaults to last 12 months).
   * - `leadType` — scope filter: CONSTRUCTION | PLUMBING | ROOFING.
   *   When omitted, company-wide data from the Cash P&L is returned.
   *   When set, aggregates project-level P&Ls for all active projects in that scope.
   */
  @Get('costs-breakdown')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getCostsBreakdown(@Query() query: DateRangeQueryDto) {
    return this.financialService.getCostsBreakdown(
      {
        from: query.from,
        to: query.to,
      },
      query.leadType,
    );
  }

  @Get('quickbooks-revenue-report')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getQuickbooksRevenueReport(@Query() query: DateRangeQueryDto) {
    return this.financialService.getQuickbooksRevenueReport({
      from: query.from,
      to: query.to,
    });
  }

  @Get('project-financials')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getProjectFinancials(@Query() query: ListLimitQueryDto) {
    return this.financialService.getProjectFinancials(
      query.limit ?? 200,
      query.leadType,
    );
  }

  @Get('project-health')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getProjectHealth(@Query() query: LeadTypeQueryDto) {
    return this.projectsService.getProjectHealth(query.leadType);
  }

  /**
   * POST /analytics/refresh
   *
   * Clears all analytics caches:
   * - QuickBooks API read cache.
   * - In-memory aggregation cache (per-project P&L).
   * - HTTP-level cache-manager cache.
   *
   * @returns { ok: true } on success.
   */
  @Post('refresh')
  async refresh() {
    this.quickbooksApiService.clearReadCache();
    this.financialService.clearAggregationCache();
    await this.cacheManager.clear();
    return { ok: true };
  }
}
