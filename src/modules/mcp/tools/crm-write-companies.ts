import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateCompanyDto } from '../../companies/company-management/dto/create-company.dto';
import { UpdateCompanyDto } from '../../companies/company-management/dto/update-company.dto';
import { CompanyType } from '../../../common/enums/company-type.enum';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { deletedMessage } from './crm-write-shared';
import { enumFromTsEnum } from './zod-utils';

const companyWritableShape = {
  name: z.string().describe('Company name'),
  address: z.string().optional().describe('Company address'),
  addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
  type: enumFromTsEnum(CompanyType).optional().describe('Company type'),
  serviceId: z.number().optional().describe('Service ID'),
  isCustomer: z.boolean().optional().describe('Is the company a customer?'),
  isClient: z.boolean().optional().describe('Is the company a client?'),
  notes: z.array(z.string()).optional().describe('Notes'),
  attachments: z
    .array(z.string())
    .optional()
    .describe('Attachment S3 keys for the company'),
  phone: z.string().optional().describe('Phone number'),
  email: z.string().optional().describe('Email address'),
  submiz: z
    .string()
    .optional()
    .describe('Sunbiz registration URL (max 2048 chars)'),
  qboVendorId: z
    .string()
    .optional()
    .describe('Linked QuickBooks vendor ID (max 64 chars)'),
  qboVendorName: z
    .string()
    .optional()
    .describe('Linked QuickBooks vendor display name (max 255 chars)'),
  qboVendorMatchConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('QuickBooks vendor match confidence (0 to 1)'),
  qboVendorMatchedAt: z
    .string()
    .optional()
    .describe('Timestamp when QBO vendor match was made (ISO 8601)'),
  qboVendorLastSyncedAt: z
    .string()
    .optional()
    .describe('Timestamp of last QBO vendor sync (ISO 8601)'),
};

export function registerCompanyWriteTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'create_company',
    'Create a new company in the CRM',
    companyWritableShape,
    async (fields: Record<string, unknown>) =>
      deps.companiesService.create(fields as unknown as CreateCompanyDto),
  );

  registerMcpTool(
    server,
    'update_company',
    'Update an existing company by its ID. Only provided fields are updated',
    {
      companyId: z.number().describe('The company ID to update'),
      ...companyWritableShape,
      name: z.string().optional().describe('Company name'),
      notes: z
        .array(z.string())
        .optional()
        .describe('Notes (replaces all existing notes)'),
    },
    async ({ companyId, ...fields }: { companyId: number } & Record<string, unknown>) =>
      deps.companiesService.update(companyId, fields as UpdateCompanyDto),
  );

  registerMcpTool(
    server,
    'delete_company',
    'Delete a company by its ID',
    { companyId: z.number().describe('The company ID to delete') },
    async ({ companyId }: { companyId: number }) => {
      await deps.companiesService.delete(companyId);
      return deletedMessage('Company', companyId);
    },
  );
}
