import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { realmIdParam } from './qbo-tool-utils';
import { registerJsonTool } from './tool-registration';

export function registerQboReportTools(server: McpServer, deps: McpToolDeps) {
  registerJsonTool(
    server,
    'get_aging_report',
    'Accounts receivable aging report: all open invoices bucketed by days overdue ' +
      '(Current, 1-30, 31-60, 61-90, 90+) with per-bucket totals and grand total outstanding.',
    { realmId: realmIdParam },
    async ({ realmId }: { realmId?: string }) =>
      deps.qboReports.getAgingReport(realmId),
  );

  registerJsonTool(
    server,
    'get_outstanding_balances',
    'All QuickBooks projects (jobs) with an open invoice balance, ' +
      'sorted by outstanding amount descending. Gives a quick view of who owes what.',
    { realmId: realmIdParam },
    async ({ realmId }: { realmId?: string }) =>
      deps.qboReports.getOutstandingBalances(realmId),
  );

  registerJsonTool(
    server,
    'get_unbilled_completed_work',
    'All QuickBooks jobs where estimated amount exceeds invoiced amount - ' +
      'work that has been quoted or contracted but not yet billed to the client. ' +
      'Sorted by backlog amount descending.',
    { realmId: realmIdParam },
    async ({ realmId }: { realmId?: string }) =>
      deps.qboReports.getUnbilledCompletedWork(realmId),
  );

  registerJsonTool(
    server,
    'get_revenue_by_period',
    'Total revenue collected (payments received) within a date range. ' +
      'Returns total amount, payment count, and full payment list.',
    {
      start: z.string().describe('Start date in YYYY-MM-DD format'),
      end: z.string().describe('End date in YYYY-MM-DD format'),
      realmId: realmIdParam,
    },
    async ({
      start,
      end,
      realmId,
    }: {
      start: string;
      end: string;
      realmId?: string;
    }) => deps.qboReports.getRevenueByPeriod(start, end, realmId),
  );

  registerJsonTool(
    server,
    'get_backlog',
    'All QuickBooks jobs with contracted (estimated) work that has not yet been invoiced. ' +
      'backlogAmount = estimatedAmount - invoicedAmount. Sorted descending.',
    { realmId: realmIdParam },
    async ({ realmId }: { realmId?: string }) => deps.qboReports.getBacklog(realmId),
  );

  registerJsonTool(
    server,
    'search_projects_by_financial_criteria',
    'Filter QuickBooks jobs by financial thresholds. All criteria are optional. ' +
      'Examples: "all projects with outstanding > $5000", ' +
      '"projects where estimated > invoiced", ' +
      '"projects with invoiced between $10k and $50k".',
    {
      minOutstanding: z.number().optional().describe('Minimum open invoice balance'),
      maxOutstanding: z.number().optional().describe('Maximum open invoice balance'),
      minInvoiced: z.number().optional().describe('Minimum total invoiced amount'),
      maxInvoiced: z.number().optional().describe('Maximum total invoiced amount'),
      minEstimated: z.number().optional().describe('Minimum total estimated amount'),
      hasUnbilledWork: z
        .boolean()
        .optional()
        .describe('Only return projects where estimated > invoiced'),
      minUnbilledAmount: z
        .number()
        .optional()
        .describe('Minimum unbilled amount (estimated - invoiced)'),
      realmId: realmIdParam,
    },
    async ({
      realmId,
      ...criteria
    }: {
      minOutstanding?: number;
      maxOutstanding?: number;
      minInvoiced?: number;
      maxInvoiced?: number;
      minEstimated?: number;
      hasUnbilledWork?: boolean;
      minUnbilledAmount?: number;
      realmId?: string;
    }) => deps.qboReports.searchByFinancialCriteria(criteria, realmId),
  );

  registerJsonTool(
    server,
    'get_top_clients_by_revenue',
    'Top clients ranked by total invoiced amount, with paid vs outstanding breakdown.',
    {
      limit: z
        .number()
        .optional()
        .describe('Number of clients to return (default: 10)'),
      realmId: realmIdParam,
    },
    async ({
      limit,
      realmId,
    }: {
      limit?: number;
      realmId?: string;
    }) => deps.qboReports.getTopClientsByRevenue(limit ?? 10, realmId),
  );
}
