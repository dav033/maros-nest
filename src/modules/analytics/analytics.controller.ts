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
import { AnalyticsClientsService } from './services/analytics-clients.service';
import { AnalyticsFinancialService } from './services/analytics-financial.service';
import { AnalyticsOverviewService } from './services/analytics-overview.service';
import { AnalyticsPipelineService } from './services/analytics-pipeline.service';
import { AnalyticsProjectsService } from './services/analytics-projects.service';
import { AnalyticsStaleLeadsService } from './services/analytics-stale-leads.service';
import { QuickbooksApiService } from '../quickbooks/services/core/quickbooks-api.service';
import { ProjectsService } from '../projects/project-management/services/projects.service';
import { DateRangeQueryDto } from './dto/queries/date-range-query.dto';
import { RevenueTrendQueryDto } from './dto/queries/revenue-trend-query.dto';
import { TopClientsQueryDto } from './dto/queries/top-clients-query.dto';
import { ClientScorecardQueryDto } from './dto/queries/client-scorecard-query.dto';
import { StaleLeadsQueryDto } from './dto/queries/stale-leads-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
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
// The money-bearing routes override this with 'finance:read'. They are gated
// whole rather than having their payloads filtered per user, because
// CacheInterceptor keys by URL — a permission-varying body would be served
// from cache to whoever asked next.
@RequirePermissions('dashboard:read')
export class AnalyticsController {
  constructor(
    private readonly overviewService: AnalyticsOverviewService,
    private readonly pipelineService: AnalyticsPipelineService,
    private readonly financialService: AnalyticsFinancialService,
    private readonly projectsService: AnalyticsProjectsService,
    private readonly clientsService: AnalyticsClientsService,
    private readonly staleLeadsService: AnalyticsStaleLeadsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly quickbooksApiService: QuickbooksApiService,
    private readonly crmProjectsService: ProjectsService,
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
  @RequirePermissions('finance:read')
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
  @RequirePermissions('finance:read')
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
  @RequirePermissions('finance:read')
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
  @RequirePermissions('finance:read')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getTopClients(@Query() query: TopClientsQueryDto) {
    const limit = query.limit ?? 5;
    const by = query.by ?? 'revenue';
    return this.financialService.getTopClients(limit, by, query.leadType, { from: query.from, to: query.to });
  }

  @Get('outstanding-balances')
  @RequirePermissions('finance:read')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getOutstandingBalances(@Query() query: ListLimitQueryDto) {
    return this.financialService.getOutstandingBalances(
      query.limit ?? 100,
      query.leadType,
    );
  }

  @Get('backlog')
  @RequirePermissions('finance:read')
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
  @RequirePermissions('finance:read')
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
  @RequirePermissions('finance:read')
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
  @RequirePermissions('finance:read')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getQuickbooksRevenueReport(@Query() query: DateRangeQueryDto) {
    return this.financialService.getQuickbooksRevenueReport({
      from: query.from,
      to: query.to,
    });
  }

  @Get('project-financials')
  @RequirePermissions('finance:read')
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
   * GET /analytics/clients/scorecard
   *
   * One row per client (contact) covering its whole lead history: counts, close rate over
   * decided leads, estimated and won value, and the date of its newest lead.
   *
   * Query params (optional):
   * - `limit` — rows to return (1–500, default 50).
   *
   * Left on the controller's `dashboard:read` rather than `finance:read`: the amounts are
   * the CRM's own `leads.estimate`, the same column /analytics/pipeline reports under
   * `dashboard:read`, not QuickBooks revenue. Whoever is meant to cultivate these clients
   * is not necessarily whoever is allowed to read the P&L.
   */
  @Get('clients/scorecard')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getClientScorecard(@Query() query: ClientScorecardQueryDto) {
    return this.clientsService.getClientScorecard(query.limit);
  }

  /**
   * GET /analytics/leads/stale
   *
   * Leads in an undecided status that have been open longer than `days`, plus totals per
   * age bucket.
   *
   * Query params (optional):
   * - `days` — age threshold, exclusive (1–3650, default 60).
   *
   * Ages are derived from `start_date`; see AnalyticsStaleLeadsService for what that does
   * and does not measure.
   */
  @Get('leads/stale')
  @CacheTTL(ANALYTICS_CACHE_TTL_MS)
  getStaleLeads(@Query() query: StaleLeadsQueryDto) {
    return this.staleLeadsService.getStaleLeads(query.days);
  }

  /**
   * POST /analytics/refresh
   *
   * Clears all analytics caches:
   * - QuickBooks API read cache.
   * - In-memory aggregation cache (per-project P&L).
   * - HTTP-level cache-manager cache.
   * - Cached GET /projects/financials payload (its own module's cache-manager
   *   instance is separate, so it has to be cleared explicitly).
   *
   * @returns { ok: true } on success.
   */
  @Post('refresh')
  async refresh() {
    this.quickbooksApiService.clearReadCache();
    this.financialService.clearAggregationCache();
    this.crmProjectsService.clearFinancialsCache();
    await this.cacheManager.clear();
    return { ok: true };
  }
}
