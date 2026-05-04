import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';
import { realmIdParam, resolveRealmId } from './qbo-tool-utils';

  export function registerQboVendorMatchingTools(server: McpServer, deps: McpToolDeps) {
    const resolveQboRealmId = (realmId?: string) =>
      resolveRealmId(deps, realmId);

    server.tool(
      'list_qbo_vendors',
      'Read-only list of QuickBooks vendors normalized for CRM supplier/subcontractor matching.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const rid = await resolveQboRealmId(realmId);
        const data = await deps.qboVendorMatching.listQboVendors(rid);
        return jsonContent(data);
      },
    );

    server.tool(
      'match_crm_companies_to_qbo_vendors',
      'Read-only matching of CRM suppliers/subcontractors to QuickBooks vendors with confidence scores.',
      {
        companyId: z
          .number()
          .optional()
          .describe('Optional CRM company ID to match only one company'),
        minConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Minimum confidence to include in candidate lists'),
        includeLowConfidence: z
          .boolean()
          .optional()
          .describe('Include low-confidence candidates. Defaults to false.'),
        maxCandidates: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum candidates per CRM company'),
        realmId: realmIdParam,
      },
      async ({ realmId, ...options }) => {
        const rid = await resolveQboRealmId(realmId);
        const data = await deps.qboVendorMatching.matchCrmCompaniesToVendors(
          rid,
          options,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'suggest_qbo_vendor_matches',
      'Read-only suggested QuickBooks vendor matches for CRM supplier/subcontractor companies.',
      {
        companyId: z
          .number()
          .optional()
          .describe('Optional CRM company ID to inspect'),
        realmId: realmIdParam,
      },
      async ({ companyId, realmId }) => {
        const rid = await resolveQboRealmId(realmId);
        const data = await deps.qboVendorMatching.suggestVendorMatches(
          rid,
          companyId,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_qbo_vendor_crm_map',
      'Read-only map from QuickBooks vendors to CRM suppliers/subcontractors for financial analysis.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const rid = await resolveQboRealmId(realmId);
        const data = await deps.qboVendorMatching.getVendorCrmMap(rid);
        return jsonContent(data);
      },
    );
  }


  export function registerQboAttachmentTools(server: McpServer, deps: McpToolDeps) {
    const resolveQboRealmId = (realmId?: string) =>
      resolveRealmId(deps, realmId);

    server.tool(
      'get_project_attachments',
      'Attachment metadata for a QuickBooks project and its related invoices, estimates, payments, vendor transactions, purchase orders, and journal entries.',
      {
        projectNumber: z
          .string()
          .optional()
          .describe('Project number, e.g. "001-0924"'),
        qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
        startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
        endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
        includeTempDownloadUrl: z
          .boolean()
          .optional()
          .describe('Include temporary QBO download URLs. Defaults to false.'),
        realmId: realmIdParam,
      },
      async (params) => {
        const data = await deps.qboAttachments.getProjectAttachments(params);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_qbo_attachments_for_entity',
      'Attachment metadata linked to one QuickBooks entity such as Invoice, Bill, Purchase, or Customer.',
      {
        entityType: z
          .string()
          .describe('QBO entity type, e.g. Invoice, Bill, Purchase'),
        entityId: z.string().describe('QBO entity ID'),
        includeTempDownloadUrl: z
          .boolean()
          .optional()
          .describe('Include temporary QBO download URLs. Defaults to false.'),
        realmId: realmIdParam,
      },
      async ({ entityType, entityId, includeTempDownloadUrl, realmId }) => {
        const rid = await resolveQboRealmId(realmId);
        const data = await deps.qboAttachments.getAttachmentsForEntity(
          rid,
          entityType,
          entityId,
          { includeTempDownloadUrl },
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_qbo_attachment_download_url',
      'Explicitly fetch a temporary QuickBooks attachment download URL. URLs are not stored.',
      {
        attachableId: z.string().describe('QBO Attachable ID'),
        realmId: realmIdParam,
      },
      async ({ attachableId, realmId }) => {
        const rid = await resolveQboRealmId(realmId);
        const data = await deps.qboAttachments.getAttachmentDownloadUrl(
          rid,
          attachableId,
        );
        return jsonContent(data);
      },
    );
  }

  // ─── Tier 4: company-wide QBO reports ──────────────────────────────────────
