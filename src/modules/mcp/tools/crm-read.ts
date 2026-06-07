import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { CompanyType } from '../../../common/enums/company-type.enum';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { enumFromTsEnum } from './zod-utils';

const includeQboList = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    'If true, attach a QBO summary (estimated/invoiced/paid/outstanding + payments) per item. Defaults to false on list calls for speed.',
  );
const includeQboSingle = z
  .boolean()
  .optional()
  .default(true)
  .describe(
    'If true (default), attach the QBO block. Set to false to skip the QuickBooks call.',
  );

export function registerLeadTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_all_leads',
    'Get all leads from the CRM (excludes leads with projects and in-review leads). ' +
      'When includeQbo=true, each lead gains a "qbo" block with estimated/invoiced/paid/outstanding from QuickBooks.',
    { includeQbo: includeQboList },
    async ({ includeQbo }: { includeQbo?: boolean }) =>
      deps.leadsService.getPipelineLeads({ includeQbo }),
  );

  registerMcpTool(
    server,
    'get_lead_by_id',
    'Get a lead by its numeric ID. Response includes a "qbo" block with the QuickBooks financial summary (estimated, invoiced, paid, outstanding, payments) unless includeQbo=false.',
    {
      leadId: z.number().describe('The lead ID'),
      includeQbo: includeQboSingle,
    },
    async ({ leadId, includeQbo }: { leadId: number; includeQbo?: boolean }) =>
      deps.leadsService.getLeadById(leadId, { includeQbo }),
  );

  registerMcpTool(
    server,
    'get_lead_by_number',
    'Get a lead by its lead number (e.g. C-001, P-002). Response includes a "qbo" block with the QuickBooks financial summary unless includeQbo=false.',
    {
      leadNumber: z.string().describe('The lead number'),
      includeQbo: includeQboSingle,
    },
    async ({ leadNumber, includeQbo }: { leadNumber: string; includeQbo?: boolean }) =>
      deps.leadsService.getLeadByNumber(leadNumber, { includeQbo }),
  );

  registerMcpTool(
    server,
    'get_lead_details',
    'Get full lead details including project information. Response includes a "qbo" block with the full QuickBooks profile (estimates, invoices, payments, expenses, attachments, profit & loss) unless includeQbo=false.',
    {
      leadId: z.number().describe('The lead ID'),
      includeQbo: includeQboSingle,
    },
    async ({ leadId, includeQbo }: { leadId: number; includeQbo?: boolean }) =>
      deps.leadsService.getLeadDetails(leadId, { includeQbo }),
  );

  registerMcpTool(
    server,
    'get_leads_in_review',
    'Get all leads currently in review. When includeQbo=true, each lead gains a "qbo" summary.',
    { includeQbo: includeQboList },
    async ({ includeQbo }: { includeQbo?: boolean }) =>
      deps.leadsService.getLeadsInReview({ includeQbo }),
  );

  registerMcpTool(
    server,
    'get_leads_by_status',
    `Get all leads filtered by status. Valid statuses: ${Object.values(LeadStatus).join(', ')}. ` +
      'When includeQbo=true, each lead gains a "qbo" summary.',
    {
      status: enumFromTsEnum(LeadStatus).describe('Lead status to filter by'),
      includeQbo: includeQboList,
    },
    async ({ status, includeQbo }: { status: string; includeQbo?: boolean }) =>
      deps.leadsService.getLeadsByStatus(status as LeadStatus, { includeQbo }),
  );

  registerMcpTool(
    server,
    'get_leads_by_contact_id',
    'Get all leads associated with a specific contact by their ID. When includeQbo=true, each lead gains a "qbo" summary.',
    {
      contactId: z.number().describe('The contact ID'),
      includeQbo: includeQboList,
    },
    async ({ contactId, includeQbo }: { contactId: number; includeQbo?: boolean }) =>
      deps.leadsService.getLeadsByContactId(contactId, { includeQbo }),
  );

  registerMcpTool(
    server,
    'get_leads_by_contact_name',
    'Get all leads associated with a contact by the contact name (partial match). When includeQbo=true, each lead gains a "qbo" summary.',
    {
      name: z.string().describe('Contact name to search for (partial match supported)'),
      includeQbo: includeQboList,
    },
    async ({ name, includeQbo }: { name: string; includeQbo?: boolean }) =>
      deps.leadsService.getLeadsByContactName(name, { includeQbo }),
  );

  registerMcpTool(
    server,
    'search_leads',
    'Search leads by name, location, or lead number (partial match). When includeQbo=true, each lead gains a "qbo" summary.',
    {
      query: z.string().describe('Text to search in lead name, location, or lead number'),
      includeQbo: includeQboList,
    },
    async ({ query, includeQbo }: { query: string; includeQbo?: boolean }) =>
      deps.leadsService.searchLeads(query, { includeQbo }),
  );
}

export function registerCompanyTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_all_companies',
    'Get all companies from the CRM',
    {},
    async () => deps.companiesService.findAll(),
  );

  registerMcpTool(
    server,
    'get_company_by_id',
    'Get a company by its numeric ID',
    { id: z.number().describe('The company ID') },
    async ({ id }: { id: number }) => deps.companiesService.findById(id),
  );

  registerMcpTool(
    server,
    'search_companies_by_name',
    'Search companies by name (partial, case-insensitive match)',
    { name: z.string().describe('Company name or partial name to search') },
    async ({ name }: { name: string }) => deps.companiesService.searchByName(name),
  );

  registerMcpTool(
    server,
    'get_companies_by_type',
    `Get all companies filtered by type. Valid types: ${Object.values(CompanyType).join(', ')}`,
    {
      type: enumFromTsEnum(CompanyType).describe('Company type to filter by'),
    },
    async ({ type }: { type: string }) =>
      deps.companiesService.findByType(type as CompanyType),
  );

  registerMcpTool(
    server,
    'get_company_with_contacts',
    'Get a company along with all its associated contacts. Accepts company ID (number) or company name (text)',
    {
      idOrName: z
        .string()
        .describe('Company ID (numeric) or company name (text, partial match)'),
    },
    async ({ idOrName }: { idOrName: string }) =>
      deps.companiesService.getCompanyWithContacts(idOrName),
  );

  registerMcpTool(
    server,
    'get_company_full_profile',
    'Get a full company profile including contacts, their leads and projects, and summary stats. Accepts company ID or name',
    {
      idOrName: z
        .string()
        .describe('Company ID (numeric) or company name (text, partial match)'),
    },
    async ({ idOrName }: { idOrName: string }) =>
      deps.companiesService.getCompanyFullProfile(idOrName),
  );

  registerMcpTool(
    server,
    'get_customer_companies',
    'Get all companies marked as customers',
    {},
    async () => deps.companiesService.findCustomers(),
  );

  registerMcpTool(
    server,
    'get_client_companies',
    'Get all companies marked as clients',
    {},
    async () => deps.companiesService.findClients(),
  );
}

export function registerContactTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_all_contacts',
    'Get all contacts from the CRM with their company info',
    {},
    async () => deps.contactsService.findAll(),
  );

  registerMcpTool(
    server,
    'get_contact_by_id',
    'Get a contact by its numeric ID',
    { id: z.number().describe('The contact ID') },
    async ({ id }: { id: number }) => deps.contactsService.getContactById(id),
  );

  registerMcpTool(
    server,
    'get_contact_details',
    'Get full contact details including all their leads, projects, and summary stats',
    { id: z.number().describe('The contact ID') },
    async ({ id }: { id: number }) => deps.contactsService.getContactDetails(id),
  );

  registerMcpTool(
    server,
    'get_contacts_by_company',
    'Get all contacts belonging to a specific company by company ID',
    { companyId: z.number().describe('The company ID') },
    async ({ companyId }: { companyId: number }) =>
      deps.contactsService.findByCompany(companyId),
  );

  registerMcpTool(
    server,
    'get_contact_by_name',
    'Get a contact by their exact name (case-insensitive)',
    { name: z.string().describe('The contact full name') },
    async ({ name }: { name: string }) => deps.contactsService.getContactByName(name),
  );

  registerMcpTool(
    server,
    'get_contact_by_email',
    'Get a contact by their email address (case-insensitive)',
    { email: z.string().describe('The contact email address') },
    async ({ email }: { email: string }) => deps.contactsService.getContactByEmail(email),
  );

  registerMcpTool(
    server,
    'get_contact_by_phone',
    'Get a contact by their phone number (exact match)',
    { phone: z.string().describe('The contact phone number') },
    async ({ phone }: { phone: string }) => deps.contactsService.getContactByPhone(phone),
  );

  registerMcpTool(
    server,
    'search_contacts',
    'Search contacts by name, email, or phone number (partial match)',
    {
      query: z.string().describe('Text to search in contact name, email, or phone'),
    },
    async ({ query }: { query: string }) => deps.contactsService.searchContacts(query),
  );

  registerMcpTool(
    server,
    'get_customer_contacts',
    'Get all contacts marked as customers',
    {},
    async () => deps.contactsService.findCustomers(),
  );

  registerMcpTool(
    server,
    'get_client_contacts',
    'Get all contacts marked as clients',
    {},
    async () => deps.contactsService.findClients(),
  );
}

export function registerProjectTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_all_projects',
    'Get all projects from the CRM with lead and contact information. Each project includes a "qbo" summary block (estimated, invoiced, paid, outstanding) from QuickBooks.',
    {},
    async () => deps.projectsService.findAll(),
  );

  registerMcpTool(
    server,
    'get_project_by_id',
    'Get a project by its numeric ID. Response includes a "qbo" summary block (estimated, invoiced, paid, outstanding, payments) from QuickBooks.',
    { id: z.number().describe('The project ID') },
    async ({ id }: { id: number }) => deps.projectsService.findById(id),
  );

  registerMcpTool(
    server,
    'get_project_details',
    'Get full project details including lead, contact, and company information. ' +
      'Response includes a "qbo" block with the full QuickBooks profile (estimates with line items, invoices, payments, expenses, attachments, profit & loss).',
    { id: z.number().describe('The project ID') },
    async ({ id }: { id: number }) => deps.projectsService.getProjectDetails(id),
  );

  registerMcpTool(
    server,
    'get_project_by_lead_number',
    'Get a project by its associated lead number (e.g. 001-0425). Response includes a "qbo" summary block.',
    {
      leadNumber: z.string().describe('The lead number associated with the project'),
    },
    async ({ leadNumber }: { leadNumber: string }) =>
      deps.projectsService.findByLeadNumber(leadNumber),
  );

  registerMcpTool(
    server,
    'get_projects_by_status',
    `Get all projects filtered by progress status. Valid statuses: ${Object.values(ProjectProgressStatus).join(', ')}.`,
    {
      status: enumFromTsEnum(ProjectProgressStatus).describe(
        'Project progress status to filter by',
      ),
    },
    async ({ status }: { status: string }) =>
      deps.projectsService.findByStatus(status as ProjectProgressStatus),
  );

  registerMcpTool(
    server,
    'get_projects_by_contact_id',
    'Get all projects associated with a specific contact by their ID.',
    { contactId: z.number().describe('The contact ID') },
    async ({ contactId }: { contactId: number }) =>
      deps.projectsService.findByContactId(contactId),
  );
}
