import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { enumFromTsEnum } from './zod-utils';

/**
 * El dashboard: KPIs, pipeline, tendencias y salud de los proyectos.
 *
 * Nada de esto estaba expuesto, aunque es lo que responde las preguntas que uno
 * hace primero ("¿cómo vamos?", "¿qué proyectos están en riesgo?", "¿en qué se
 * fue el dinero este trimestre?"). Las tools financieras que ya existían
 * contestan sobre una entidad concreta; estas agregan sobre todas.
 *
 * Una diferencia que conviene conocer: las rutas HTTP llevan un interceptor de
 * caché de 5 minutos, y el MCP llama a los servicios directamente, así que estas
 * tools NO pasan por esa caché. Son más lentas que el dashboard y, a cambio, más
 * frescas. Los servicios sí conservan sus cachés internas de agregación, que es
 * lo que `refresh_analytics_cache` limpia.
 */

const leadType = enumFromTsEnum(LeadType)
  .optional()
  .describe('Acota a una línea de negocio: CONSTRUCTION, PLUMBING o ROOFING');

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD');

const dateRange = {
  from: isoDay.optional(),
  to: isoDay.optional(),
  leadType,
};

type Range = { from?: string; to?: string; leadType?: LeadType };

export function registerAnalyticsTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_analytics_overview',
    'Los KPIs de cabecera en una sola llamada: leads, proyectos, ganados y perdidos, tasa de conversión, ingresos, pendiente de cobro, backlog, pipeline y beneficio.',
    dateRange,
    async (query: Range) => deps.analyticsOverview.getOverview(query),
  );

  registerMcpTool(
    server,
    'get_leads_pipeline',
    'Los leads agrupados por estado, con cuántos hay y el valor estimado de cada grupo.',
    { leadType },
    async ({ leadType: lt }: { leadType?: LeadType }) =>
      deps.analyticsPipeline.getPipeline(lt),
  );

  registerMcpTool(
    server,
    'get_projects_status_summary',
    'Los proyectos agrupados por estado, para ver de un golpe en qué fase está la cartera.',
    { leadType },
    async ({ leadType: lt }: { leadType?: LeadType }) =>
      deps.analyticsPipeline.getProjectsStatus(lt),
  );

  registerMcpTool(
    server,
    'get_financial_snapshot',
    'Totales de la cartera: cuántos proyectos, estimado, facturado, cobrado y pendiente.',
    { leadType },
    async ({ leadType: lt }: { leadType?: LeadType }) =>
      deps.analyticsFinancial.getFinancialSnapshot(lt),
  );

  registerMcpTool(
    server,
    'get_leads_per_month',
    'Cuántos leads entraron cada mes. Sirve para ver estacionalidad y si el flujo de entrada sube o baja.',
    {
      months: z
        .number()
        .int()
        .min(1)
        .max(24)
        .optional()
        .describe('Meses hacia atrás; 12 si se omite'),
      ...dateRange,
    },
    async ({ months, ...range }: { months?: number } & Range) =>
      deps.analyticsPipeline.getLeadsPerMonth(months ?? 12, range),
  );

  registerMcpTool(
    server,
    'get_revenue_trend',
    'Los ingresos mes a mes.',
    {
      months: z.number().int().min(1).max(24).optional().describe('12 si se omite'),
      ...dateRange,
    },
    async ({ months, ...range }: { months?: number } & Range) =>
      deps.analyticsFinancial.getRevenueTrend(months ?? 12, range),
  );

  registerMcpTool(
    server,
    'get_top_clients_ranked',
    'Los mejores clientes, ordenados por facturación o por número de trabajos.',
    {
      limit: z.number().int().min(1).max(20).optional().describe('5 si se omite'),
      by: z
        .enum(['revenue', 'volume'])
        .optional()
        .describe('revenue = dinero; volume = cantidad de trabajos. revenue si se omite'),
      ...dateRange,
    },
    async ({
      limit,
      by,
      from,
      to,
      leadType: lt,
    }: { limit?: number; by?: 'revenue' | 'volume' } & Range) =>
      deps.analyticsFinancial.getTopClients(limit ?? 5, by ?? 'revenue', lt, { from, to }),
  );

  registerMcpTool(
    server,
    'get_outstanding_balances_summary',
    'Lo que está pendiente de cobro, cliente por cliente.',
    {
      limit: z.number().int().min(1).max(500).optional().describe('100 si se omite'),
      leadType,
    },
    async ({ limit, leadType: lt }: { limit?: number; leadType?: LeadType }) =>
      deps.analyticsFinancial.getOutstandingBalances(limit ?? 100, lt),
  );

  registerMcpTool(
    server,
    'get_backlog_summary',
    'El backlog: trabajo vendido y todavía no facturado.',
    {
      limit: z.number().int().min(1).max(500).optional().describe('100 si se omite'),
      leadType,
    },
    async ({ limit, leadType: lt }: { limit?: number; leadType?: LeadType }) =>
      deps.analyticsFinancial.getBacklog(limit ?? 100, lt),
  );

  registerMcpTool(
    server,
    'get_expenses_summary',
    'Gastos y coste de ventas del periodo, en dos totales.',
    dateRange,
    async ({ from, to, leadType: lt }: Range) =>
      deps.analyticsFinancial.getExpensesSummary({ from, to }, lt),
  );

  registerMcpTool(
    server,
    'get_costs_breakdown',
    'En qué se fue el dinero: los costes desglosados por categoría, separando EXPENSES de COGS.',
    dateRange,
    async ({ from, to, leadType: lt }: Range) =>
      deps.analyticsFinancial.getCostsBreakdown({ from, to }, lt),
  );

  registerMcpTool(
    server,
    'get_quickbooks_revenue_report',
    'El reporte de ingresos tal como lo calcula QuickBooks, para cuadrar contra las cifras del CRM.',
    { from: isoDay.optional(), to: isoDay.optional() },
    async ({ from, to }: { from?: string; to?: string }) =>
      deps.analyticsFinancial.getQuickbooksRevenueReport({ from, to }),
  );

  registerMcpTool(
    server,
    'get_project_financials_summary',
    'Una fila por proyecto con sus cifras: estimado, facturado, cobrado y pendiente.',
    {
      limit: z.number().int().min(1).max(500).optional().describe('200 si se omite'),
      leadType,
    },
    async ({ limit, leadType: lt }: { limit?: number; leadType?: LeadType }) =>
      deps.analyticsFinancial.getProjectFinancials(limit ?? 200, lt),
  );

  registerMcpTool(
    server,
    'get_project_health',
    'Los proyectos en riesgo y por qué: la vista de "projects at risk" del dashboard.',
    { leadType },
    async ({ leadType: lt }: { leadType?: LeadType }) =>
      deps.analyticsProjects.getProjectHealth(lt),
  );

  registerMcpTool(
    server,
    'refresh_analytics_cache',
    'Tira las cachés de agregación y las de lectura de QuickBooks. Úsalo cuando una cifra se vea desactualizada después de un cambio; las siguientes consultas serán lentas pero exactas.',
    {},
    // Las tres limpiezas son sincronas: Promise.resolve en vez de un async sin
    // await, que el lint marca con razon.
    () => {
      deps.qboApi.clearReadCache();
      deps.analyticsFinancial.clearAggregationCache();
      deps.projectsService.clearFinancialsCache();
      return Promise.resolve({
        ok: true,
        cleared: ['qbo_read', 'analytics_aggregation', 'project_financials'],
      });
    },
  );
}
