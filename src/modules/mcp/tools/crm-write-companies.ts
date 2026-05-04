import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateCompanyDto } from '../../companies/company-management/dto/create-company.dto';
import { UpdateCompanyDto } from '../../companies/company-management/dto/update-company.dto';
import { CompanyType } from '../../../common/enums/company-type.enum';
import { McpToolDeps, jsonContent } from './shared';
import { deletedMessage } from './crm-write-shared';
import { enumFromTsEnum } from './zod-utils';

export function registerCompanyWriteTools(server: McpServer, deps: McpToolDeps) {
  server.tool(
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
    async (fields) => {
      const data = await deps.companiesService.create(fields as CreateCompanyDto);
      return jsonContent(data);
    },
  );

  server.tool(
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
    async ({ companyId, ...fields }) => {
      const data = await deps.companiesService.update(
        companyId,
        fields as UpdateCompanyDto,
      );
      return jsonContent(data);
    },
  );

  server.tool(
    'delete_company',
    'Delete a company by its ID',
    { companyId: z.number().describe('The company ID to delete') },
    async ({ companyId }) => {
      await deps.companiesService.delete(companyId);
      return deletedMessage('Company', companyId);
    },
  );
}
