import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { realmIdParam } from './qbo-tool-utils';

export function registerQboProjectTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_project_financials',
    'Aggregated financial summary for one or more project numbers from QuickBooks: ' +
      'estimated amount, invoiced amount, paid, outstanding, and payment percentage. ' +
      'Use get_project_detail for normalized transactions with line items.',
    {
      projectNumbers: z
        .array(z.string())
        .min(1)
        .describe('Project numbers, e.g. ["001-0924"]'),
      realmId: realmIdParam,
    },
    async ({
      projectNumbers,
      realmId,
    }: {
      projectNumbers: string[];
      realmId?: string;
    }) => deps.qboFinancials.getProjectFinancials(projectNumbers, realmId),
  );

  registerMcpTool(
    server,
    'get_project_detail',
    'Full QuickBooks detail for one or more project numbers: the QBO job record, ' +
      'normalized Estimates with line items, normalized Invoices with line items, ' +
      'normalized Payments, and an aggregated financial summary.',
    {
      projectNumbers: z
        .array(z.string())
        .min(1)
        .describe('Project numbers, e.g. ["001-0924"]'),
      realmId: realmIdParam,
    },
    async ({
      projectNumbers,
      realmId,
    }: {
      projectNumbers: string[];
      realmId?: string;
    }) => deps.qboFinancials.getProjectDetail(projectNumbers, realmId),
  );

  registerMcpTool(
    server,
    'get_invoices_by_project',
    'List all invoices for a project with number, date, amount, balance, due date, and derived status (Paid/Partial/Overdue/Pending).',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getInvoicesByProject(projectNumber, realmId),
  );

  registerMcpTool(
    server,
    'get_invoice_by_id',
    'Normalized invoice detail from QuickBooks by QBO invoice ID, including all line items.',
    {
      invoiceId: z.string().describe('QBO invoice ID'),
      realmId: realmIdParam,
    },
    async ({ invoiceId, realmId }: { invoiceId: string; realmId?: string }) =>
      deps.qboFinancials.getInvoiceById(invoiceId, realmId),
  );

  registerMcpTool(
    server,
    'get_estimates_by_project',
    'All estimates for a project with full line items, status (Pending/Accepted/Closed), and amounts.',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getEstimatesByProject(projectNumber, realmId),
  );

  registerMcpTool(
    server,
    'get_estimate_by_id',
    'Normalized estimate detail from QuickBooks by QBO estimate ID, including all line items.',
    {
      estimateId: z.string().describe('QBO estimate ID'),
      realmId: realmIdParam,
    },
    async ({ estimateId, realmId }: { estimateId: string; realmId?: string }) =>
      deps.qboFinancials.getEstimateById(estimateId, realmId),
  );

  registerMcpTool(
    server,
    'get_payments_by_project',
    'All payments received for a project with date, amount, payment method, and linked invoices.',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getPaymentsByProject(projectNumber, realmId),
  );

  registerMcpTool(
    server,
    'get_unbilled_work',
    'Unbilled work for a project: total estimated minus total invoiced, ' +
      'with normalized estimate and invoice transactions so line items can be compared. ' +
      'A positive unbilledAmount means work was quoted but not yet billed.',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getUnbilledWork(projectNumber, realmId),
  );

  registerMcpTool(
    server,
    'get_expenses_by_project',
    'All vendor expenses (Purchases) charged against a project in QuickBooks. ' +
      'Returns vendor name, date, amount, payment type (Cash/CreditCard/Check), ' +
      'and account-based line items. These are the "Expense" rows in the QBO Transactions tab.',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getExpensesByProject(projectNumber, realmId),
  );

  registerMcpTool(
    server,
    'get_attachments_by_project',
    'Files and documents attached to a QuickBooks project (job). ' +
      'Returns file name, size, content type, note, dates, and linked entity metadata. ' +
      'Temporary download URLs are intentionally not returned.',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getAttachmentsByProject(projectNumber, realmId),
  );

  registerMcpTool(
    server,
    'get_project_full_profile',
    'Complete QuickBooks data for a single project in one call: ' +
      'QBO job record, aggregated financial summary, normalized estimates with line items, ' +
      'normalized invoices with line items, normalized payments, normalized vendor expenses, ' +
      'all attachments, and the full Profit & Loss report. ' +
      'Use this when you need everything about a project. ' +
      'For lighter reads use the isolated tools (get_invoices_by_project, get_expenses_by_project, etc.).',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getProjectFullProfile(projectNumber, realmId),
  );
}
