import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { McpToolDeps, jsonContent } from './shared';
import { realmIdParam } from './qbo-tool-utils';

export function registerQboCrmReports(server: McpServer, deps: McpToolDeps) {
  server.tool(
    'get_pipeline_value',
    'Leads grouped by status with count per status. ' +
      'Gives a snapshot of the sales pipeline. ' +
      'Use get_project_financials on specific lead numbers to add monetary values.',
    {},
    async () => {
      const [allLeads, inReview] = await Promise.all([
        deps.leadsService.getPipelineLeads(),
        deps.leadsService.getLeadsInReview(),
      ]);
      const byStatus: Record<string, { count: number; leads: unknown[] }> = {};
      for (const lead of [...allLeads, ...inReview]) {
        const status = (lead as { status?: string }).status ?? 'UNKNOWN';
        if (!byStatus[status]) byStatus[status] = { count: 0, leads: [] };
        byStatus[status].count += 1;
        byStatus[status].leads.push(lead);
      }
      return jsonContent(byStatus);
    },
  );

  server.tool(
    'get_win_rate',
    'Win rate: percentage of leads that were converted to a project. ' +
      'Based on CRM data (projects / total pipeline leads).',
    {},
    async () => {
      const [allLeads, inReview, projects] = await Promise.all([
        deps.leadsService.getPipelineLeads(),
        deps.leadsService.getLeadsInReview(),
        deps.projectsService.findAll(),
      ]);
      const openLeads = allLeads.length + inReview.length;
      const won = projects.length;
      const total = openLeads + won;
      const winRate = total > 0 ? Math.round((won / total) * 10000) / 100 : 0;
      return jsonContent({
        totalLeads: total,
        convertedToProject: won,
        openLeads,
        winRate,
      });
    },
  );

  server.tool(
    'get_unbilled_completed_work_crm',
    'Projects with COMPLETED status in the CRM that have unbilled work in QuickBooks ' +
      '(estimated > invoiced). Combines CRM project data with QBO financials.',
    { realmId: realmIdParam },
    async ({ realmId }) => {
      const completedProjects = await deps.projectsService.findByStatus(
        ProjectProgressStatus.COMPLETED,
      );

      const leadNumbers = completedProjects
        .map((project: Record<string, unknown>) => {
          const lead = project['lead'] as { leadNumber?: string } | undefined;
          return lead?.leadNumber ?? null;
        })
        .filter(Boolean) as string[];

      if (!leadNumbers.length) return jsonContent([]);

      const financials = await deps.qboFinancials.getProjectFinancials(
        leadNumbers,
        realmId,
      );
      const unbilled = financials.filter((fin) => fin.estimateVsInvoicedDelta > 0);

      const enriched = unbilled.map((fin) => {
        const project = completedProjects.find(
          (candidate: Record<string, unknown>) =>
            (candidate['lead'] as { leadNumber?: string } | undefined)
              ?.leadNumber === fin.projectNumber,
        );
        return { ...fin, crmProject: project };
      });

      return jsonContent(enriched);
    },
  );

  server.tool(
    'get_top_clients_by_volume',
    'Top clients ranked by number of projects in the CRM.',
    {
      limit: z
        .number()
        .optional()
        .describe('Number of clients to return (default: 10)'),
    },
    async ({ limit = 10 }) => {
      const projects = await deps.projectsService.findAll();
      const byClient: Record<
        string,
        { count: number; clientName: string; projects: unknown[] }
      > = {};

      for (const project of projects as Record<string, unknown>[]) {
        const contact = project['contact'] as
          | { name?: string; id?: number }
          | undefined;
        const key = String(contact?.id ?? 'unknown');
        if (!byClient[key]) {
          byClient[key] = {
            count: 0,
            clientName: contact?.name ?? key,
            projects: [],
          };
        }
        byClient[key].count += 1;
        byClient[key].projects.push(project);
      }

      const sorted = Object.values(byClient)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return jsonContent(sorted);
    },
  );

  server.tool(
    'get_company_financial_snapshot',
    'Full financial overview of the entire company: reads every project from the CRM, ' +
      'fetches their QuickBooks financials in a single batch, and returns per-project numbers ' +
      '(estimated, invoiced, paid, outstanding) plus company-wide totals. ' +
      'Use this to understand the current financial state of the business at a glance. ' +
      'Projects not found in QuickBooks are flagged with found=false.',
    { realmId: realmIdParam },
    async ({ realmId }) => {
      const allProjects = (await deps.projectsService.findAll()) as Record<
        string,
        unknown
      >[];

      const projectsWithLeadNumbers = allProjects.map((project) => ({
        projectId: project['id'],
        leadNumber:
          (project['lead'] as { leadNumber?: string } | undefined)?.leadNumber ??
          null,
        contactName: (project['contact'] as { name?: string } | undefined)?.name ?? null,
        companyName:
          ((project['contact'] as Record<string, unknown> | undefined)?.[
            'company'
          ] as { name?: string } | undefined)?.name ?? null,
        projectProgressStatus: project['projectProgressStatus'],
        invoiceStatus: project['invoiceStatus'],
      }));

      const leadNumbers = projectsWithLeadNumbers
        .map((project) => project.leadNumber)
        .filter(Boolean) as string[];

      const financials = leadNumbers.length
        ? await deps.qboFinancials.getProjectFinancials(leadNumbers, realmId)
        : [];

      const financialsByLeadNumber = new Map(
        financials.map((fin) => [fin.projectNumber, fin]),
      );

      const projects = projectsWithLeadNumbers.map((project) => {
        const qbo = project.leadNumber
          ? (financialsByLeadNumber.get(project.leadNumber) ?? null)
          : null;
        return {
          ...project,
          qbo: qbo
            ? {
                found: qbo.found,
                estimatedAmount: qbo.estimatedAmount,
                invoicedAmount: qbo.invoicedAmount,
                paidAmount: qbo.paidAmount,
                outstandingAmount: qbo.outstandingAmount,
                paidPercentage: qbo.paidPercentage,
                estimateVsInvoicedDelta: qbo.estimateVsInvoicedDelta,
              }
            : null,
        };
      });

      const totals = {
        totalProjects: projects.length,
        foundInQbo: projects.filter((project) => project.qbo?.found).length,
        notFoundInQbo: projects.filter((project) => !project.qbo?.found).length,
        totalEstimated: projects.reduce(
          (sum, project) => sum + (project.qbo?.estimatedAmount ?? 0),
          0,
        ),
        totalInvoiced: projects.reduce(
          (sum, project) => sum + (project.qbo?.invoicedAmount ?? 0),
          0,
        ),
        totalPaid: projects.reduce(
          (sum, project) => sum + (project.qbo?.paidAmount ?? 0),
          0,
        ),
        totalOutstanding: projects.reduce(
          (sum, project) => sum + (project.qbo?.outstandingAmount ?? 0),
          0,
        ),
        totalUnbilled: projects.reduce(
          (sum, project) => sum + Math.max(0, project.qbo?.estimateVsInvoicedDelta ?? 0),
          0,
        ),
      };

      return jsonContent({ totals, projects });
    },
  );
}
