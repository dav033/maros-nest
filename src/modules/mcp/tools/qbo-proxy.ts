import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';
import { realmIdParam, resolveRealmId } from './qbo-tool-utils';

  export function registerQboProxyTools(server: McpServer, deps: McpToolDeps) {
    const resolveRealm = (realmId?: string): Promise<string> =>
      resolveRealmId(deps, realmId);

    server.tool(
      'qb_get_invoice',
      'Fetch a QuickBooks invoice directly by its QBO ID. Returns the full object including line items, customer, dates, and amounts.',
      {
        invoiceId: z.string().describe('QBO invoice ID'),
        realmId: realmIdParam,
      },
      async ({ invoiceId, realmId }) => {
        const rid = await resolveRealm(realmId);
        const data = await deps.qboApi.getById(rid, 'invoice', invoiceId);
        return jsonContent(data);
      },
    );

    server.tool(
      'qb_get_payment',
      'Fetch a QuickBooks payment directly by its QBO ID. Returns method, amount, date, and linked invoices.',
      {
        paymentId: z.string().describe('QBO payment ID'),
        realmId: realmIdParam,
      },
      async ({ paymentId, realmId }) => {
        const rid = await resolveRealm(realmId);
        const data = await deps.qboApi.getById(rid, 'payment', paymentId);
        return jsonContent(data);
      },
    );

    server.tool(
      'qb_get_customer',
      'Fetch a QuickBooks customer (or job/sub-customer) directly by its QBO ID.',
      {
        customerId: z.string().describe('QBO customer ID'),
        realmId: realmIdParam,
      },
      async ({ customerId, realmId }) => {
        const rid = await resolveRealm(realmId);
        const data = await deps.qboApi.getById(rid, 'customer', customerId);
        return jsonContent(data);
      },
    );

    server.tool(
      'qb_get_estimate',
      'Fetch a QuickBooks estimate directly by its QBO ID. Returns full object with all line items.',
      {
        estimateId: z.string().describe('QBO estimate ID'),
        realmId: realmIdParam,
      },
      async ({ estimateId, realmId }) => {
        const rid = await resolveRealm(realmId);
        const data = await deps.qboApi.getById(rid, 'estimate', estimateId);
        return jsonContent(data);
      },
    );

    server.tool(
      'qb_sync_project',
      'Force a fresh data pull from QuickBooks for a project number. ' +
        'Returns the same payload as get_project_detail but always bypasses any cache. ' +
        'Use when you suspect stale data.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await deps.qboFinancials.getProjectDetail(
          [projectNumber],
          realmId,
        );
        return jsonContent(data);
      },
    );
  }
