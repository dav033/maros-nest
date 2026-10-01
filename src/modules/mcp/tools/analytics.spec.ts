import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerAnalyticsTools } from './analytics';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function registerTools() {
  const tools = new Map<string, Registered>();
  const server = {
    tool: (
      name: string,
      description: string,
      schema: ZodRawShape,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      tools.set(name, { description, schema, handler });
    },
  };

  const analyticsOverview = { getOverview: jest.fn().mockResolvedValue({}) };
  const analyticsPipeline = {
    getPipeline: jest.fn().mockResolvedValue([]),
    getProjectsStatus: jest.fn().mockResolvedValue([]),
    getLeadsPerMonth: jest.fn().mockResolvedValue([]),
  };
  const analyticsFinancial = {
    getFinancialSnapshot: jest.fn().mockResolvedValue({}),
    getRevenueTrend: jest.fn().mockResolvedValue([]),
    getTopClients: jest.fn().mockResolvedValue([]),
    getOutstandingBalances: jest.fn().mockResolvedValue([]),
    getBacklog: jest.fn().mockResolvedValue([]),
    getExpensesSummary: jest.fn().mockResolvedValue({}),
    getCostsBreakdown: jest.fn().mockResolvedValue({}),
    getQuickbooksRevenueReport: jest.fn().mockResolvedValue({}),
    getProjectFinancials: jest.fn().mockResolvedValue([]),
    clearAggregationCache: jest.fn(),
  };
  const analyticsProjects = { getProjectHealth: jest.fn().mockResolvedValue([]) };
  const qboApi = { clearReadCache: jest.fn() };
  const projectsService = { clearFinancialsCache: jest.fn() };

  registerAnalyticsTools(server as unknown as McpServer, {
    analyticsOverview,
    analyticsPipeline,
    analyticsFinancial,
    analyticsProjects,
    qboApi,
    projectsService,
  } as unknown as McpToolDeps);

  return {
    tools,
    analyticsOverview,
    analyticsPipeline,
    analyticsFinancial,
    analyticsProjects,
    qboApi,
    projectsService,
  };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

describe('registerAnalyticsTools', () => {
  it('registers the fifteen dashboard tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'get_analytics_overview',
      'get_backlog_summary',
      'get_costs_breakdown',
      'get_expenses_summary',
      'get_financial_snapshot',
      'get_leads_per_month',
      'get_leads_pipeline',
      'get_outstanding_balances_summary',
      'get_project_financials_summary',
      'get_project_health',
      'get_projects_status_summary',
      'get_quickbooks_revenue_report',
      'get_revenue_trend',
      'get_top_clients_ranked',
      'refresh_analytics_cache',
    ]);
  });

  // Las rutas HTTP ponen estos valores por defecto; llamando al servicio directo
  // nadie los pone, asi que las tools tienen que hacerlo o el servicio recibe
  // undefined donde espera un numero.
  describe('the defaults the HTTP layer used to apply', () => {
    it('asks for 12 months when none is given', async () => {
      const { tools, analyticsFinancial, analyticsPipeline } = registerTools();

      await tools.get('get_revenue_trend')!.handler({});
      await tools.get('get_leads_per_month')!.handler({});

      expect(analyticsFinancial.getRevenueTrend).toHaveBeenCalledWith(12, {});
      expect(analyticsPipeline.getLeadsPerMonth).toHaveBeenCalledWith(12, {});
    });

    it('asks for 5 top clients by revenue', async () => {
      const { tools, analyticsFinancial } = registerTools();

      await tools.get('get_top_clients_ranked')!.handler({});

      expect(analyticsFinancial.getTopClients).toHaveBeenCalledWith(5, 'revenue', undefined, {
        from: undefined,
        to: undefined,
      });
    });

    it('uses 100 for lists and 200 for project financials', async () => {
      const { tools, analyticsFinancial } = registerTools();

      await tools.get('get_outstanding_balances_summary')!.handler({});
      await tools.get('get_backlog_summary')!.handler({});
      await tools.get('get_project_financials_summary')!.handler({});

      expect(analyticsFinancial.getOutstandingBalances).toHaveBeenCalledWith(100, undefined);
      expect(analyticsFinancial.getBacklog).toHaveBeenCalledWith(100, undefined);
      expect(analyticsFinancial.getProjectFinancials).toHaveBeenCalledWith(200, undefined);
    });
  });

  it('passes the range and the lead type through', async () => {
    const { tools, analyticsOverview, analyticsFinancial } = registerTools();

    await tools
      .get('get_analytics_overview')!
      .handler({ from: '2026-01-01', to: '2026-03-31', leadType: 'PLUMBING' });
    await tools
      .get('get_costs_breakdown')!
      .handler({ from: '2026-01-01', to: '2026-03-31', leadType: 'ROOFING' });

    expect(analyticsOverview.getOverview).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-03-31',
      leadType: 'PLUMBING',
    });
    expect(analyticsFinancial.getCostsBreakdown).toHaveBeenCalledWith(
      { from: '2026-01-01', to: '2026-03-31' },
      'ROOFING',
    );
  });

  it('clears all three caches and says which ones', async () => {
    const { tools, qboApi, analyticsFinancial, projectsService } = registerTools();

    const result = await callJson(tools.get('refresh_analytics_cache')!, {});

    expect(qboApi.clearReadCache).toHaveBeenCalled();
    expect(analyticsFinancial.clearAggregationCache).toHaveBeenCalled();
    expect(projectsService.clearFinancialsCache).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      cleared: ['qbo_read', 'analytics_aggregation', 'project_financials'],
    });
  });

  describe('validation', () => {
    it.each([
      ['a lead type that does not exist', 'get_leads_pipeline', { leadType: 'ELECTRICAL' }],
      ['a date that is not YYYY-MM-DD', 'get_analytics_overview', { from: 'enero' }],
      ['more than 24 months', 'get_revenue_trend', { months: 36 }],
      ['zero months', 'get_revenue_trend', { months: 0 }],
      ['more than 20 top clients', 'get_top_clients_ranked', { limit: 50 }],
      ['a sort that does not exist', 'get_top_clients_ranked', { by: 'alphabetical' }],
    ])('rejects %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('accepts the three real lead types', () => {
      const { tools } = registerTools();

      for (const leadType of ['CONSTRUCTION', 'PLUMBING', 'ROOFING']) {
        expect(parse(tools.get('get_leads_pipeline')!.schema, { leadType }).success).toBe(
          true,
        );
      }
    });
  });

  // Las rutas llevan @CacheTTL de 5 minutos; el MCP no pasa por ahi.
  it('warns in its own text that these calls skip the dashboard cache', () => {
    const { tools } = registerTools();

    expect(tools.get('refresh_analytics_cache')!.description).toContain('cach');
  });
});
