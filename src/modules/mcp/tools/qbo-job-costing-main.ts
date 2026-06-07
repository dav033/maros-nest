import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createQboJobCostingHelpers } from './qbo-job-costing-helpers';
import { McpToolDeps, QBO_TRANSACTION_TYPES } from './shared';
import { registerMcpTool } from './tool-registration';
import { realmIdParam } from './qbo-tool-utils';

export function registerQboJobCostingMainTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const helpers = createQboJobCostingHelpers(deps);

  type JobCostHelperParams = Parameters<
    typeof helpers.buildProjectJobCostSummaryPayload
  >[0];
  type CashOutHelperParams = Parameters<typeof helpers.buildProjectCashOutPayload>[0];
  type ApHelperParams = Parameters<typeof helpers.buildProjectApStatusPayload>[0];
  type VendorTxHelperParams = Parameters<
    typeof helpers.buildProjectVendorTransactionsPayload
  >[0];
  type VendorTxParams = Parameters<typeof helpers.buildVendorTransactionsPayload>[0];
  type TxAttachmentParams = Parameters<
    typeof helpers.buildTransactionAttachmentsPayload
  >[0];
  type TxByIdParams = Parameters<typeof helpers.buildTransactionByIdPayload>[0];
  type ReportBundleParams = Parameters<
    typeof helpers.buildProjectReportBundlePayload
  >[0];
  type LegacyJobCostParams = Parameters<
    typeof deps.qboJobCosting.getProjectCashOut
  >[0];

  const jobCostParams = {
    projectNumber: z.string().optional().describe('Project number, e.g. "001-0924"'),
    qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
    vendorId: z.string().optional().describe('QBO Vendor ID'),
    vendorName: z.string().optional().describe('QBO Vendor display name'),
    startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
    endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
    includeAttachments: z.boolean().optional().describe('Include attachment metadata. Defaults to true.'),
    includeAttachmentDownloadUrls: z
      .boolean()
      .optional()
      .describe('Include temporary QBO attachment download URLs. Defaults to false.'),
    includeRaw: z.boolean().optional().describe('Include raw QBO objects. Defaults to false.'),
    realmId: realmIdParam,
  };
  const projectAnalysisParams = {
    projectNumber: z.string().optional().describe('Project number, e.g. "001-0924"'),
    qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
    realmId: realmIdParam,
    startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
    endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
    includeAttachments: z.boolean().default(true).describe('Include attachment metadata. Defaults to true.'),
    includeReports: z.boolean().default(true).describe('Include report bundle when dates are provided. Defaults to true.'),
    includeRaw: z.boolean().default(false).describe('Include raw QBO objects. Defaults to false.'),
  };
  const projectCostParams = {
    projectNumber: z.string().optional().describe('Project number, e.g. "001-0924"'),
    qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
    realmId: realmIdParam,
    startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
    endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
    includeAttachments: z.boolean().default(true).describe('Include attachment metadata. Defaults to true.'),
    includeRaw: z.boolean().default(false).describe('Include raw QBO objects. Defaults to false.'),
  };

  registerMcpTool(
    server,
    'qbo_get_project_job_cost_summary',
    'Obtiene resumen financiero completo de un proyecto: contrato/estimates, invoices, customer payments, cash out pagado, bills abiertas, vendor credits, purchase orders, P&L, attachments y utilidad estimada.',
    projectAnalysisParams,
    async (params: JobCostHelperParams) =>
      helpers.safeQboTool(() => helpers.buildProjectJobCostSummaryPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_project_cash_out',
    'Lista cash out real del proyecto: purchases, checks, credit card purchases, bill payments, bills abiertas, vendor credits y journal adjustments separados por estado.',
    projectCostParams,
    async (params: CashOutHelperParams) =>
      helpers.safeQboTool(() => helpers.buildProjectCashOutPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_project_ap_status',
    'Muestra cuentas por pagar abiertas del proyecto por vendor/subcontractor, aging, due date, balance y attachments.',
    projectCostParams,
    async (params: ApHelperParams) =>
      helpers.safeQboTool(() => helpers.buildProjectApStatusPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_project_vendor_transactions',
    'Agrupa transacciones del proyecto por vendor/subcontractor, con total pagado, abierto, créditos, attachments y categorías.',
    {
      projectNumber: z.string().optional().describe('Project number, e.g. "001-0924"'),
      qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
      vendorId: z.string().optional().describe('QBO Vendor ID'),
      vendorName: z.string().optional().describe('QBO Vendor display name'),
      startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
      endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
      includeAttachments: z.boolean().default(true).describe('Include attachment metadata. Defaults to true.'),
      includeRaw: z.boolean().default(false).describe('Include raw QBO objects. Defaults to false.'),
      realmId: realmIdParam,
    },
    async (params: VendorTxHelperParams) =>
      helpers.safeQboTool(() => helpers.buildProjectVendorTransactionsPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_vendor_transactions',
    'Consulta transacciones por vendor/subcontractor, con o sin proyecto.',
    {
      vendorId: z.string().optional().describe('QBO Vendor ID'),
      vendorName: z.string().optional().describe('QBO Vendor display name'),
      projectNumber: z.string().optional().describe('Project number, e.g. "001-0924"'),
      qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
      startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
      endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
      transactionTypes: z.array(z.enum(QBO_TRANSACTION_TYPES)).optional().describe('Transaction types to include'),
      includeAttachments: z.boolean().default(true).describe('Include attachment metadata. Defaults to true.'),
      includeRaw: z.boolean().default(false).describe('Include raw QBO objects. Defaults to false.'),
      realmId: realmIdParam,
    },
    async (params: VendorTxParams) =>
      helpers.safeQboTool(() => helpers.buildVendorTransactionsPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_transaction_attachments',
    'Trae attachments de una transacción específica.',
    {
      entityType: z.enum(QBO_TRANSACTION_TYPES).describe('QBO transaction type'),
      entityId: z.string().describe('QBO transaction ID'),
      realmId: realmIdParam,
      includeDownloadUrl: z.boolean().default(false).describe('Include temporary download URL. Defaults to false.'),
    },
    async (params: TxAttachmentParams) =>
      helpers.safeQboTool(() => helpers.buildTransactionAttachmentsPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_qbo_transaction_by_id',
    'Obtiene una transacción QBO específica normalizada por tipo e ID.',
    {
      entityType: z.enum(QBO_TRANSACTION_TYPES).describe('QBO transaction type'),
      entityId: z.string().describe('QBO transaction ID'),
      realmId: realmIdParam,
      includeAttachments: z.boolean().default(true).describe('Include attachment metadata. Defaults to true.'),
      includeRaw: z.boolean().default(false).describe('Include raw QBO object. Defaults to false.'),
    },
    async (params: TxByIdParams) =>
      helpers.safeQboTool(() => helpers.buildTransactionByIdPayload(params)),
  );
  registerMcpTool(
    server,
    'qbo_get_project_report_bundle',
    'Trae reportes financieros relevantes del proyecto en formato resumido y plano.',
    {
      projectNumber: z.string().optional().describe('Project number, e.g. "001-0924"'),
      qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
      startDate: z.string().describe('Start date in YYYY-MM-DD'),
      endDate: z.string().describe('End date in YYYY-MM-DD'),
      accountingMethod: z.enum(['Cash', 'Accrual']).optional().describe('Accounting method'),
      includeRaw: z.boolean().default(false).describe('Include raw QBO report payloads. Defaults to false.'),
      realmId: realmIdParam,
    },
    async (params: ReportBundleParams) =>
      helpers.safeQboTool(() => helpers.buildProjectReportBundlePayload(params)),
  );

  registerMcpTool(
    server,
    'get_project_cash_out',
    'Project job costing: paid cash out, open A/P, committed purchase orders, vendor credits, and adjustments.',
    jobCostParams,
    async (params: LegacyJobCostParams) =>
      deps.qboJobCosting.getProjectCashOut(params),
  );
  registerMcpTool(
    server,
    'get_project_vendor_transactions',
    'Project vendor/subcontractor transactions from QuickBooks job costing.',
    jobCostParams,
    async (params: LegacyJobCostParams) =>
      deps.qboJobCosting.getProjectVendorTransactions(params),
  );
  registerMcpTool(
    server,
    'get_project_ap_status',
    'Project accounts payable status: open bills, bill payments, and vendor credits.',
    jobCostParams,
    async (params: LegacyJobCostParams) =>
      deps.qboJobCosting.getProjectApStatus(params),
  );
  registerMcpTool(
    server,
    'get_project_job_cost_summary',
    'Project job cost summary with vendor and category breakdowns.',
    jobCostParams,
    async (params: LegacyJobCostParams) =>
      deps.qboJobCosting.getProjectJobCostSummary(params),
  );
  registerMcpTool(
    server,
    'get_vendor_transactions',
    'QuickBooks vendor transactions across purchases, bills, bill payments, credits, purchase orders, and adjustments.',
    jobCostParams,
    async (params: LegacyJobCostParams) =>
      deps.qboJobCosting.getVendorTransactions(params),
  );
}
