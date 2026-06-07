import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateCompanyDto } from '../../companies/company-management/dto/create-company.dto';
import { UpdateCompanyDto } from '../../companies/company-management/dto/update-company.dto';
import { CompanyType } from '../../../common/enums/company-type.enum';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { deletedMessage } from './crm-write-shared';
import { enumFromTsEnum } from './zod-utils';

export function registerCompanyWriteTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'create_company',
    'Create a new company in the CRM',
    {
      name: z.string().describe('Company name'),
      address: z.string().optional().describe('Company address'),
      addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
      type: enumFromTsEnum(CompanyType).optional().describe('Company type'),
      serviceId: z.number().optional().describe('Service ID'),
      isCustomer: z.boolean().optional().describe('Is the company a customer?'),
      isClient: z.boolean().optional().describe('Is the company a client?'),
      notes: z.array(z.string()).optional().describe('Notes'),
      phone: z.string().optional().describe('Phone number'),
      email: z.string().optional().describe('Email address'),
    },
    async (fields: Record<string, unknown>) =>
      deps.companiesService.create(fields as unknown as CreateCompanyDto),
  );

  registerMcpTool(
    server,
    'update_company',
    'Update an existing company by its ID. Only provided fields are updated',
    {
      companyId: z.number().describe('The company ID to update'),
      name: z.string().optional().describe('Company name'),
      address: z.string().optional().describe('Company address'),
      addressLink: z.string().optional().describe('Address link'),
      type: enumFromTsEnum(CompanyType).optional().describe('Company type'),
      serviceId: z.number().optional().describe('Service ID'),
      isCustomer: z.boolean().optional().describe('Is the company a customer?'),
      isClient: z.boolean().optional().describe('Is the company a client?'),
      notes: z
        .array(z.string())
        .optional()
        .describe('Notes (replaces all existing notes)'),
      phone: z.string().optional().describe('Phone number'),
      email: z.string().optional().describe('Email address'),
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
