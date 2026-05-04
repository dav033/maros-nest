import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';
import { realmIdParam } from './qbo-tool-utils';

  export function registerQboProjectTools(server: McpServer, deps: McpToolDeps) {
    server.tool(
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
      async ({ projectNumbers, realmId }) => {
        const data = await deps.qboFinancials.getProjectFinancials(
          projectNumbers,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
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
      async ({ projectNumbers, realmId }) => {
        const data = await deps.qboFinancials.getProjectDetail(
          projectNumbers,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_invoices_by_project',
      'List all invoices for a project with number, date, amount, balance, due date, and derived status (Paid/Partial/Overdue/Pending).',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getInvoicesByProject(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_invoice_by_id',
      'Normalized invoice detail from QuickBooks by QBO invoice ID, including all line items.',
      {
        invoiceId: z.string().describe('QBO invoice ID'),
        realmId: realmIdParam,
      },
      async ({ invoiceId, realmId }) => {
        const data = await deps.qboFinancials.getInvoiceById(
          invoiceId,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_estimates_by_project',
      'All estimates for a project with full line items, status (Pending/Accepted/Closed), and amounts.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getEstimatesByProject(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_estimate_by_id',
      'Normalized estimate detail from QuickBooks by QBO estimate ID, including all line items.',
      {
        estimateId: z.string().describe('QBO estimate ID'),
        realmId: realmIdParam,
      },
      async ({ estimateId, realmId }) => {
        const data = await deps.qboFinancials.getEstimateById(
          estimateId,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_payments_by_project',
      'All payments received for a project with date, amount, payment method, and linked invoices.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getPaymentsByProject(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_unbilled_work',
      'Unbilled work for a project: total estimated minus total invoiced, ' +
        'with normalized estimate and invoice transactions so line items can be compared. ' +
        'A positive unbilledAmount means work was quoted but not yet billed.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getUnbilledWork(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_expenses_by_project',
      'All vendor expenses (Purchases) charged against a project in QuickBooks. ' +
        'Returns vendor name, date, amount, payment type (Cash/CreditCard/Check), ' +
        'and account-based line items. These are the "Expense" rows in the QBO Transactions tab.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getExpensesByProject(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_attachments_by_project',
      'Files and documents attached to a QuickBooks project (job). ' +
        'Returns file name, size, content type, note, dates, and linked entity metadata. ' +
        'Temporary download URLs are intentionally not returned.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getAttachmentsByProject(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
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
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getProjectFullProfile(
          projectNumber,
          realmId,
        );
        return jsonContent(data);
      },
    );
  }
