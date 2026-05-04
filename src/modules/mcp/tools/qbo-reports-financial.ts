import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ReportParams } from '../../quickbooks/services/reports/quickbooks-reports.service';
import { McpToolDeps, jsonContent } from './shared';
import { realmIdParam } from './qbo-tool-utils';

export function registerQboFinancialReportTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const reportParamsSchema = {
    realmId: realmIdParam,
    startDate: z.string().describe('Start date in YYYY-MM-DD format'),
    endDate: z.string().describe('End date in YYYY-MM-DD format'),
    customerId: z
      .string()
      .optional()
      .describe('QuickBooks customer/job ID to filter by (for project-scoped reports)'),
    vendorId: z.string().optional().describe('QuickBooks vendor ID to filter by'),
    accountingMethod: z
      .enum(['Cash', 'Accrual'])
      .optional()
      .describe('Accounting method (default: company setting)'),
    summarizeColumnBy: z
      .string()
      .optional()
      .describe('Summarize columns by period, e.g. Month, Quarter, Year'),
    includeRaw: z
      .boolean()
      .optional()
      .describe('Include raw QBO JSON in response (default false)'),
  };

  const toParams = (args: {
    realmId?: string;
    startDate: string;
    endDate: string;
    customerId?: string;
    vendorId?: string;
    accountingMethod?: 'Cash' | 'Accrual';
    summarizeColumnBy?: string;
    includeRaw?: boolean;
  }): ReportParams => args;

  server.tool(
    'get_profit_and_loss_detail',
    'QuickBooks Profit & Loss Detail report for a date range. Returns a flat list of ' +
      'income/expense rows with section, group, account label, and amount. ' +
      'Optionally filter by customerId (QBO job ID) for a single project. ' +
      'Date ranges longer than 6 months are split automatically.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getProfitAndLossDetail(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_cash_flow',
    'QuickBooks Cash Flow Statement for a date range. Shows operating, investing, and ' +
      'financing activities as parsed flat rows. Splits ranges > 6 months automatically.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getCashFlow(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_vendor_expenses',
    'QuickBooks Vendor Expenses report. Shows what has been spent per vendor in the ' +
      'given date range, parsed into flat rows with vendor name, category, and amount.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getVendorExpenses(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_vendor_balance',
    'QuickBooks Vendor Balance report (point-in-time as of endDate). ' +
      'Shows the outstanding balance owed to each vendor.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getVendorBalance(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_vendor_balance_detail',
    'QuickBooks Vendor Balance Detail report. Shows the individual bills and credits ' +
      'that make up each vendor balance for the given date range.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getVendorBalanceDetail(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_aged_payables',
    'QuickBooks Aged Payables report (A/P aging, point-in-time as of endDate). ' +
      'Shows overdue bills grouped by vendor. Use to understand what the company owes.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getAgedPayables(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_aged_payable_detail',
    'QuickBooks Aged Payable Detail report. Drill-down of the A/P aging with ' +
      'individual bill lines per vendor.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getAgedPayableDetail(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_general_ledger_detail',
    'QuickBooks General Ledger Detail report for a date range. Returns every posted ' +
      'transaction line with account, date, entity, and amount. ' +
      'Can be filtered by customerId or vendorId. ' +
      'Long ranges are split into 6-month chunks automatically - use narrower ranges ' +
      'for faster responses.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getGeneralLedgerDetail(toParams(args));
      return jsonContent(data);
    },
  );

  server.tool(
    'get_project_profit_and_loss',
    'Profit & Loss report scoped to a single QuickBooks project (job). ' +
      'Returns income, COGS, expenses, gross profit, and net profit broken down by category. ' +
      'This is the existing summary P&L - for line-level detail use get_profit_and_loss_detail ' +
      'with the customerId parameter.',
    {
      projectNumber: z.string().describe('Project / lead number, e.g. "C-001"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }) => {
      const data = await deps.qboFinancials.getProjectProfitAndLoss(
        projectNumber,
        realmId,
      );
      return jsonContent(data);
    },
  );

  server.tool(
    'get_project_report_bundle',
    'Comprehensive financial report bundle for a project or date range. ' +
      'Returns Profit & Loss (summary + detail), Vendor Expenses, Aged Payables, and ' +
      'Vendor Balance Detail - all parsed into flat rows ready for analysis. ' +
      'Pass customerId (QBO job ID) to scope reports to a single project. ' +
      'Ranges longer than 6 months are split and combined automatically. ' +
      'Includes a warnings array for any report that could not be fetched.',
    reportParamsSchema,
    async (args) => {
      const data = await deps.qboReports.getProjectReportBundle(toParams(args));
      return jsonContent(data);
    },
  );
}
