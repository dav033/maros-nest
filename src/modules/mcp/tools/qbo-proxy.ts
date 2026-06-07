import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { realmIdParam, resolveRealmId } from './qbo-tool-utils';

export function registerQboProxyTools(server: McpServer, deps: McpToolDeps) {
  const resolveRealm = (realmId?: string): Promise<string> =>
    resolveRealmId(deps, realmId);

  registerMcpTool(
    server,
    'qb_get_invoice',
    'Fetch a QuickBooks invoice directly by its QBO ID. Returns the full object including line items, customer, dates, and amounts.',
    {
      invoiceId: z.string().describe('QBO invoice ID'),
      realmId: realmIdParam,
    },
    async ({ invoiceId, realmId }: { invoiceId: string; realmId?: string }) => {
      const rid = await resolveRealm(realmId);
      return deps.qboApi.getById(rid, 'invoice', invoiceId);
    },
  );

  registerMcpTool(
    server,
    'qb_get_payment',
    'Fetch a QuickBooks payment directly by its QBO ID. Returns method, amount, date, and linked invoices.',
    {
      paymentId: z.string().describe('QBO payment ID'),
      realmId: realmIdParam,
    },
    async ({ paymentId, realmId }: { paymentId: string; realmId?: string }) => {
      const rid = await resolveRealm(realmId);
      return deps.qboApi.getById(rid, 'payment', paymentId);
    },
  );

  registerMcpTool(
    server,
    'qb_get_customer',
    'Fetch a QuickBooks customer (or job/sub-customer) directly by its QBO ID.',
    {
      customerId: z.string().describe('QBO customer ID'),
      realmId: realmIdParam,
    },
    async ({ customerId, realmId }: { customerId: string; realmId?: string }) => {
      const rid = await resolveRealm(realmId);
      return deps.qboApi.getById(rid, 'customer', customerId);
    },
  );

  registerMcpTool(
    server,
    'qb_get_estimate',
    'Fetch a QuickBooks estimate directly by its QBO ID. Returns full object with all line items.',
    {
      estimateId: z.string().describe('QBO estimate ID'),
      realmId: realmIdParam,
    },
    async ({ estimateId, realmId }: { estimateId: string; realmId?: string }) => {
      const rid = await resolveRealm(realmId);
      return deps.qboApi.getById(rid, 'estimate', estimateId);
    },
  );

  registerMcpTool(
    server,
    'qb_sync_project',
    'Force a fresh data pull from QuickBooks for a project number. ' +
      'Returns the same payload as get_project_detail but always bypasses any cache. ' +
      'Use when you suspect stale data.',
    {
      projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
      realmId: realmIdParam,
    },
    async ({ projectNumber, realmId }: { projectNumber: string; realmId?: string }) =>
      deps.qboFinancials.getProjectDetail([projectNumber], realmId),
  );
}
