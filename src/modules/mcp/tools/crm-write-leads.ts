import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateLeadDto } from '../../leads/lead-management/dto/create-lead.dto';
import { CreateContactDto } from '../../contacts/contact-management/dto/create-contact.dto';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { enumFromTsEnum } from './zod-utils';

export function registerLeadWriteTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'create_lead_with_existing_contact',
    'Create a new lead and associate it with an existing contact by contact ID',
    {
      contactId: z.number().describe('ID of the existing contact'),
      leadNumber: z
        .string()
        .optional()
        .describe('Lead number (auto-generated if omitted)'),
      name: z.string().optional().describe('Lead name (auto-generated if omitted)'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      location: z.string().optional().describe('Location'),
      addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
      status: enumFromTsEnum(LeadStatus).optional().describe('Lead status'),
      projectTypeId: z.number().optional().describe('Project type ID'),
      notes: z.array(z.string()).optional().describe('Notes'),
      inReview: z.boolean().optional().describe('Whether the lead is in review'),
    },
    async ({ contactId, ...leadFields }: { contactId: number } & Record<string, unknown>) => {
      const lead = leadFields as CreateLeadDto;
      return deps.leadsService.createLeadWithExistingContact(lead, contactId);
    },
  );

  registerMcpTool(
    server,
    'create_lead_with_new_contact',
    'Create a new lead together with a new contact',
    {
      contact_name: z.string().optional().describe('Contact name'),
      contact_phone: z.string().optional().describe('Contact phone'),
      contact_email: z.string().optional().describe('Contact email'),
      contact_occupation: z.string().optional().describe('Contact occupation'),
      contact_address: z.string().optional().describe('Contact address'),
      contact_companyId: z.number().optional().describe('Company ID for the contact'),
      contact_isCustomer: z.boolean().optional().describe('Is the contact a customer?'),
      contact_isClient: z.boolean().optional().describe('Is the contact a client?'),
      contact_notes: z.array(z.string()).optional().describe('Contact notes'),
      leadNumber: z
        .string()
        .optional()
        .describe('Lead number (auto-generated if omitted)'),
      name: z.string().optional().describe('Lead name'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      location: z.string().optional().describe('Location'),
      addressLink: z.string().optional().describe('Address link'),
      status: enumFromTsEnum(LeadStatus).optional().describe('Lead status'),
      projectTypeId: z.number().optional().describe('Project type ID'),
      notes: z.array(z.string()).optional().describe('Lead notes'),
      inReview: z.boolean().optional().describe('Whether the lead is in review'),
    },
    async ({
      contact_name,
      contact_phone,
      contact_email,
      contact_occupation,
      contact_address,
      contact_companyId,
      contact_isCustomer,
      contact_isClient,
      contact_notes,
      ...leadFields
    }: Record<string, unknown>) => {
      const contact: CreateContactDto = {
        name: contact_name as string | undefined,
        phone: contact_phone as string | undefined,
        email: contact_email as string | undefined,
        occupation: contact_occupation as string | undefined,
        address: contact_address as string | undefined,
        companyId: contact_companyId as number | undefined,
        isCustomer: contact_isCustomer as boolean | undefined,
        isClient: contact_isClient as boolean | undefined,
        notes: contact_notes as string[] | undefined,
      };
      const lead = leadFields as CreateLeadDto;
      return deps.leadsService.createLeadWithNewContact(lead, contact);
    },
  );

  registerMcpTool(
    server,
    'update_lead',
    'Update an existing lead by its ID. Only provided fields are updated',
    {
      leadId: z.number().describe('The lead ID to update'),
      leadNumber: z.string().optional().describe('Lead number'),
      name: z.string().optional().describe('Lead name'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      location: z.string().optional().describe('Location'),
      addressLink: z.string().optional().describe('Address link'),
      status: enumFromTsEnum(LeadStatus).optional().describe('Lead status'),
      projectTypeId: z.number().optional().describe('Project type ID'),
      notes: z
        .array(z.string())
        .optional()
        .describe('Notes (replaces all existing notes)'),
      inReview: z.boolean().optional().describe('Whether the lead is in review'),
    },
    async ({ leadId, ...fields }: { leadId: number } & Record<string, unknown>) =>
      deps.leadsService.updateLead(leadId, fields as CreateLeadDto),
  );

  registerMcpTool(
    server,
    'delete_lead',
    'Delete a lead by its ID. Optionally also delete the associated contact and/or company',
    {
      leadId: z.number().describe('The lead ID to delete'),
      deleteContact: z
        .boolean()
        .optional()
        .describe('Also delete the associated contact?'),
      deleteCompany: z
        .boolean()
        .optional()
        .describe('Also delete the associated company?'),
    },
    async ({
      leadId,
      deleteContact,
      deleteCompany,
    }: {
      leadId: number;
      deleteContact?: boolean;
      deleteCompany?: boolean;
    }) => deps.leadsService.deleteLead(leadId, { deleteContact, deleteCompany }),
  );
}
