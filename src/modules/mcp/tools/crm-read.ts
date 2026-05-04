import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { CompanyType } from '../../../common/enums/company-type.enum';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { enumFromTsEnum } from './zod-utils';

  export function registerLeadTools(server: McpServer, deps: McpToolDeps) {
    server.tool(
      'get_all_leads',
      'Get all leads from the CRM (excludes leads with projects and in-review leads)',
      {},
      async () => {
        const data = await deps.leadsService.getPipelineLeads();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_lead_by_id',
      'Get a lead by its numeric ID',
      { leadId: z.number().describe('The lead ID') },
      async ({ leadId }) => {
        const data = await deps.leadsService.getLeadById(leadId);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_lead_by_number',
      'Get a lead by its lead number (e.g. C-001, P-002)',
      { leadNumber: z.string().describe('The lead number') },
      async ({ leadNumber }) => {
        const data = await deps.leadsService.getLeadByNumber(leadNumber);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_lead_details',
      'Get full lead details including project information',
      { leadId: z.number().describe('The lead ID') },
      async ({ leadId }) => {
        const data = await deps.leadsService.getLeadDetails(leadId);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_leads_in_review',
      'Get all leads currently in review',
      {},
      async () => {
        const data = await deps.leadsService.getLeadsInReview();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_leads_by_status',
      `Get all leads filtered by status. Valid statuses: ${Object.values(LeadStatus).join(', ')}`,
      {
        status: enumFromTsEnum(LeadStatus).describe('Lead status to filter by'),
      },
      async ({ status }) => {
        const data = await deps.leadsService.getLeadsByStatus(
          status as LeadStatus,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_leads_by_contact_id',
      'Get all leads associated with a specific contact by their ID',
      { contactId: z.number().describe('The contact ID') },
      async ({ contactId }) => {
        const data = await deps.leadsService.getLeadsByContactId(contactId);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_leads_by_contact_name',
      'Get all leads associated with a contact by the contact name (partial match)',
      {
        name: z
          .string()
          .describe('Contact name to search for (partial match supported)'),
      },
      async ({ name }) => {
        const data = await deps.leadsService.getLeadsByContactName(name);
        return jsonContent(data);
      },
    );

    server.tool(
      'search_leads',
      'Search leads by name, location, or lead number (partial match)',
      {
        query: z
          .string()
          .describe('Text to search in lead name, location, or lead number'),
      },
      async ({ query }) => {
        const data = await deps.leadsService.searchLeads(query);
        return jsonContent(data);
      },
    );
  }


  export function registerCompanyTools(server: McpServer, deps: McpToolDeps) {
    server.tool(
      'get_all_companies',
      'Get all companies from the CRM',
      {},
      async () => {
        const data = await deps.companiesService.findAll();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_company_by_id',
      'Get a company by its numeric ID',
      { id: z.number().describe('The company ID') },
      async ({ id }) => {
        const data = await deps.companiesService.findById(id);
        return jsonContent(data);
      },
    );

    server.tool(
      'search_companies_by_name',
      'Search companies by name (partial, case-insensitive match)',
      { name: z.string().describe('Company name or partial name to search') },
      async ({ name }) => {
        const data = await deps.companiesService.searchByName(name);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_companies_by_type',
      `Get all companies filtered by type. Valid types: ${Object.values(CompanyType).join(', ')}`,
      {
        type: enumFromTsEnum(CompanyType).describe('Company type to filter by'),
      },
      async ({ type }) => {
        const data = await deps.companiesService.findByType(
          type as CompanyType,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_company_with_contacts',
      'Get a company along with all its associated contacts. Accepts company ID (number) or company name (text)',
      {
        idOrName: z
          .string()
          .describe(
            'Company ID (numeric) or company name (text, partial match)',
          ),
      },
      async ({ idOrName }) => {
        const data =
          await deps.companiesService.getCompanyWithContacts(idOrName);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_company_full_profile',
      'Get a full company profile including contacts, their leads and projects, and summary stats. Accepts company ID or name',
      {
        idOrName: z
          .string()
          .describe(
            'Company ID (numeric) or company name (text, partial match)',
          ),
      },
      async ({ idOrName }) => {
        const data =
          await deps.companiesService.getCompanyFullProfile(idOrName);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_customer_companies',
      'Get all companies marked as customers',
      {},
      async () => {
        const data = await deps.companiesService.findCustomers();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_client_companies',
      'Get all companies marked as clients',
      {},
      async () => {
        const data = await deps.companiesService.findClients();
        return jsonContent(data);
      },
    );
  }


  export function registerContactTools(server: McpServer, deps: McpToolDeps) {
    server.tool(
      'get_all_contacts',
      'Get all contacts from the CRM with their company info',
      {},
      async () => {
        const data = await deps.contactsService.findAll();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_contact_by_id',
      'Get a contact by its numeric ID',
      { id: z.number().describe('The contact ID') },
      async ({ id }) => {
        const data = await deps.contactsService.getContactById(id);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_contact_details',
      'Get full contact details including all their leads, projects, and summary stats',
      { id: z.number().describe('The contact ID') },
      async ({ id }) => {
        const data = await deps.contactsService.getContactDetails(id);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_contacts_by_company',
      'Get all contacts belonging to a specific company by company ID',
      { companyId: z.number().describe('The company ID') },
      async ({ companyId }) => {
        const data = await deps.contactsService.findByCompany(companyId);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_contact_by_name',
      'Get a contact by their exact name (case-insensitive)',
      { name: z.string().describe('The contact full name') },
      async ({ name }) => {
        const data = await deps.contactsService.getContactByName(name);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_contact_by_email',
      'Get a contact by their email address (case-insensitive)',
      { email: z.string().describe('The contact email address') },
      async ({ email }) => {
        const data = await deps.contactsService.getContactByEmail(email);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_contact_by_phone',
      'Get a contact by their phone number (exact match)',
      { phone: z.string().describe('The contact phone number') },
      async ({ phone }) => {
        const data = await deps.contactsService.getContactByPhone(phone);
        return jsonContent(data);
      },
    );

    server.tool(
      'search_contacts',
      'Search contacts by name, email, or phone number (partial match)',
      {
        query: z
          .string()
          .describe('Text to search in contact name, email, or phone'),
      },
      async ({ query }) => {
        const data = await deps.contactsService.searchContacts(query);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_customer_contacts',
      'Get all contacts marked as customers',
      {},
      async () => {
        const data = await deps.contactsService.findCustomers();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_client_contacts',
      'Get all contacts marked as clients',
      {},
      async () => {
        const data = await deps.contactsService.findClients();
        return jsonContent(data);
      },
    );
  }


  export function registerProjectTools(server: McpServer, deps: McpToolDeps) {
    server.tool(
      'get_all_projects',
      'Get all projects from the CRM with lead and contact information',
      {},
      async () => {
        const data = await deps.projectsService.findAll();
        return jsonContent(data);
      },
    );

    server.tool(
      'get_project_by_id',
      'Get a project by its numeric ID',
      { id: z.number().describe('The project ID') },
      async ({ id }) => {
        const data = await deps.projectsService.findById(id);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_project_details',
      'Get full project details including lead, contact, and company information',
      { id: z.number().describe('The project ID') },
      async ({ id }) => {
        const data = await deps.projectsService.getProjectDetails(id);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_project_by_lead_number',
      'Get a project by its associated lead number (e.g. 001-0425)',
      {
        leadNumber: z
          .string()
          .describe('The lead number associated with the project'),
      },
      async ({ leadNumber }) => {
        const data = await deps.projectsService.findByLeadNumber(leadNumber);
        return jsonContent(data);
      },
    );

    server.tool(
      'get_projects_by_status',
      `Get all projects filtered by progress status. Valid statuses: ${Object.values(ProjectProgressStatus).join(', ')}`,
      {
        status: enumFromTsEnum(ProjectProgressStatus).describe(
          'Project progress status to filter by',
        ),
      },
      async ({ status }) => {
        const data = await deps.projectsService.findByStatus(
          status as ProjectProgressStatus,
        );
        return jsonContent(data);
      },
    );

    server.tool(
      'get_projects_by_contact_id',
      'Get all projects associated with a specific contact by their ID',
      { contactId: z.number().describe('The contact ID') },
      async ({ contactId }) => {
        const data = await deps.projectsService.findByContactId(contactId);
        return jsonContent(data);
      },
    );
  }
