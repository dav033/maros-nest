import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LeadsService } from '../leads/services/leads.service';
import { CompaniesService } from '../companies/services/companies.service';
import { ContactsService } from '../contacts/services/contacts.service';
import { ProjectsService } from '../projects/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/quickbooks-financials.service';
import { QuickbooksReportsService } from '../../quickbooks/services/quickbooks-reports.service';
import { QuickbooksApiService } from '../../quickbooks/services/quickbooks-api.service';
import { ProjectProgressStatus } from '../../common/enums/project-progress-status.enum';
import { CreateLeadDto } from '../leads/dto/create-lead.dto';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { UpdateContactDto } from '../contacts/dto/update-contact.dto';
import { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { UpdateCompanyDto } from '../companies/dto/update-company.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { LeadStatus } from '../../common/enums/lead-status.enum';
import { LeadType } from '../../common/enums/lead-type.enum';
import { CompanyType } from '../../common/enums/company-type.enum';
import { ProjectProgressStatus } from '../../common/enums/project-progress-status.enum';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

@Injectable()
export class McpService {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly companiesService: CompaniesService,
    private readonly contactsService: ContactsService,
    private readonly projectsService: ProjectsService,
    private readonly qboFinancials: QuickbooksFinancialsService,
    private readonly qboReports: QuickbooksReportsService,
    private readonly qboApi: QuickbooksApiService,
  ) {}

  createServer(): McpServer {
    const server = new McpServer({
      name: 'maros-construction-mcp',
      version: '1.0.0',
    });

    this.registerLeadTools(server);
    this.registerLeadWriteTools(server);
    this.registerCompanyTools(server);
    this.registerCompanyWriteTools(server);
    this.registerContactTools(server);
    this.registerContactWriteTools(server);
    this.registerProjectTools(server);
    this.registerProjectWriteTools(server);
    this.registerQboProjectTools(server);
    this.registerQboReportTools(server);
    this.registerQboCrmReports(server);
    this.registerQboProxyTools(server);

    return server;
  }

  private registerLeadTools(server: McpServer) {
    server.tool('get_all_leads', 'Get all leads from the CRM (excludes leads with projects and in-review leads)', {}, async () => {
      const data = await this.leadsService.getAllLeads();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_lead_by_id',
      'Get a lead by its numeric ID',
      { leadId: z.number().describe('The lead ID') },
      async ({ leadId }) => {
        const data = await this.leadsService.getLeadById(leadId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_lead_by_number',
      'Get a lead by its lead number (e.g. C-001, P-002)',
      { leadNumber: z.string().describe('The lead number') },
      async ({ leadNumber }) => {
        const data = await this.leadsService.getLeadByNumber(leadNumber);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_lead_details',
      'Get full lead details including project information',
      { leadId: z.number().describe('The lead ID') },
      async ({ leadId }) => {
        const data = await this.leadsService.getLeadDetails(leadId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool('get_leads_in_review', 'Get all leads currently in review', {}, async () => {
      const data = await this.leadsService.getLeadsInReview();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_leads_by_status',
      `Get all leads filtered by status. Valid statuses: ${Object.values(LeadStatus).join(', ')}`,
      { status: z.enum(Object.values(LeadStatus) as [string, ...string[]]).describe('Lead status to filter by') },
      async ({ status }) => {
        const data = await this.leadsService.getLeadsByStatus(status as LeadStatus);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_leads_by_contact_id',
      'Get all leads associated with a specific contact by their ID',
      { contactId: z.number().describe('The contact ID') },
      async ({ contactId }) => {
        const data = await this.leadsService.getLeadsByContactId(contactId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_leads_by_contact_name',
      'Get all leads associated with a contact by the contact name (partial match)',
      { name: z.string().describe('Contact name to search for (partial match supported)') },
      async ({ name }) => {
        const data = await this.leadsService.getLeadsByContactName(name);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'search_leads',
      'Search leads by name, location, or lead number (partial match)',
      { query: z.string().describe('Text to search in lead name, location, or lead number') },
      async ({ query }) => {
        const data = await this.leadsService.searchLeads(query);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerCompanyTools(server: McpServer) {
    server.tool('get_all_companies', 'Get all companies from the CRM', {}, async () => {
      const data = await this.companiesService.findAll();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_company_by_id',
      'Get a company by its numeric ID',
      { id: z.number().describe('The company ID') },
      async ({ id }) => {
        const data = await this.companiesService.findById(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'search_companies_by_name',
      'Search companies by name (partial, case-insensitive match)',
      { name: z.string().describe('Company name or partial name to search') },
      async ({ name }) => {
        const data = await this.companiesService.searchByName(name);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_companies_by_type',
      `Get all companies filtered by type. Valid types: ${Object.values(CompanyType).join(', ')}`,
      { type: z.enum(Object.values(CompanyType) as [string, ...string[]]).describe('Company type to filter by') },
      async ({ type }) => {
        const data = await this.companiesService.findByType(type as CompanyType);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_company_with_contacts',
      'Get a company along with all its associated contacts. Accepts company ID (number) or company name (text)',
      { idOrName: z.string().describe('Company ID (numeric) or company name (text, partial match)') },
      async ({ idOrName }) => {
        const data = await this.companiesService.getCompanyWithContacts(idOrName);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_company_full_profile',
      'Get a full company profile including contacts, their leads and projects, and summary stats. Accepts company ID or name',
      { idOrName: z.string().describe('Company ID (numeric) or company name (text, partial match)') },
      async ({ idOrName }) => {
        const data = await this.companiesService.getCompanyFullProfile(idOrName);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool('get_customer_companies', 'Get all companies marked as customers', {}, async () => {
      const data = await this.companiesService.findCustomers();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool('get_client_companies', 'Get all companies marked as clients', {}, async () => {
      const data = await this.companiesService.findClients();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });
  }

  private registerContactTools(server: McpServer) {
    server.tool('get_all_contacts', 'Get all contacts from the CRM with their company info', {}, async () => {
      const data = await this.contactsService.findAll();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_contact_by_id',
      'Get a contact by its numeric ID',
      { id: z.number().describe('The contact ID') },
      async ({ id }) => {
        const data = await this.contactsService.getContactById(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contact_details',
      'Get full contact details including all their leads, projects, and summary stats',
      { id: z.number().describe('The contact ID') },
      async ({ id }) => {
        const data = await this.contactsService.getContactDetails(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contacts_by_company',
      'Get all contacts belonging to a specific company by company ID',
      { companyId: z.number().describe('The company ID') },
      async ({ companyId }) => {
        const data = await this.contactsService.findByCompany(companyId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contact_by_name',
      'Get a contact by their exact name (case-insensitive)',
      { name: z.string().describe('The contact full name') },
      async ({ name }) => {
        const data = await this.contactsService.getContactByName(name);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contact_by_email',
      'Get a contact by their email address (case-insensitive)',
      { email: z.string().describe('The contact email address') },
      async ({ email }) => {
        const data = await this.contactsService.getContactByEmail(email);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contact_by_phone',
      'Get a contact by their phone number (exact match)',
      { phone: z.string().describe('The contact phone number') },
      async ({ phone }) => {
        const data = await this.contactsService.getContactByPhone(phone);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'search_contacts',
      'Search contacts by name, email, or phone number (partial match)',
      { query: z.string().describe('Text to search in contact name, email, or phone') },
      async ({ query }) => {
        const data = await this.contactsService.searchContacts(query);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool('get_customer_contacts', 'Get all contacts marked as customers', {}, async () => {
      const data = await this.contactsService.findCustomers();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool('get_client_contacts', 'Get all contacts marked as clients', {}, async () => {
      const data = await this.contactsService.findClients();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });
  }

  private registerLeadWriteTools(server: McpServer) {
    server.tool(
      'create_lead_with_existing_contact',
      'Create a new lead and associate it with an existing contact by contact ID',
      {
        contactId: z.number().describe('ID of the existing contact'),
        leadNumber: z.string().optional().describe('Lead number (auto-generated if omitted)'),
        name: z.string().optional().describe('Lead name (auto-generated if omitted)'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        location: z.string().optional().describe('Location'),
        addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
        status: z.enum(Object.values(LeadStatus) as [string, ...string[]]).optional().describe('Lead status'),
        projectTypeId: z.number().optional().describe('Project type ID'),
        notes: z.array(z.string()).optional().describe('Notes'),
        inReview: z.boolean().optional().describe('Whether the lead is in review'),
      },
      async ({ contactId, ...leadFields }) => {
        const lead: CreateLeadDto = leadFields as CreateLeadDto;
        const data = await this.leadsService.createLeadWithExistingContact(lead, contactId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
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
        leadNumber: z.string().optional().describe('Lead number (auto-generated if omitted)'),
        name: z.string().optional().describe('Lead name'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        location: z.string().optional().describe('Location'),
        addressLink: z.string().optional().describe('Address link'),
        status: z.enum(Object.values(LeadStatus) as [string, ...string[]]).optional().describe('Lead status'),
        projectTypeId: z.number().optional().describe('Project type ID'),
        notes: z.array(z.string()).optional().describe('Lead notes'),
        inReview: z.boolean().optional().describe('Whether the lead is in review'),
      },
      async ({ contact_name, contact_phone, contact_email, contact_occupation, contact_address, contact_companyId, contact_isCustomer, contact_isClient, contact_notes, ...leadFields }) => {
        const contact: CreateContactDto = {
          name: contact_name,
          phone: contact_phone,
          email: contact_email,
          occupation: contact_occupation,
          address: contact_address,
          companyId: contact_companyId,
          isCustomer: contact_isCustomer,
          isClient: contact_isClient,
          notes: contact_notes,
        };
        const lead: CreateLeadDto = leadFields as CreateLeadDto;
        const data = await this.leadsService.createLeadWithNewContact(lead, contact);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'update_lead',
      'Update an existing lead by its ID. Only provided fields are updated',
      {
        leadId: z.number().describe('The lead ID to update'),
        leadNumber: z.string().optional().describe('Lead number'),
        name: z.string().optional().describe('Lead name'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        location: z.string().optional().describe('Location'),
        addressLink: z.string().optional().describe('Address link'),
        status: z.enum(Object.values(LeadStatus) as [string, ...string[]]).optional().describe('Lead status'),
        projectTypeId: z.number().optional().describe('Project type ID'),
        notes: z.array(z.string()).optional().describe('Notes (replaces all existing notes)'),
        inReview: z.boolean().optional().describe('Whether the lead is in review'),
      },
      async ({ leadId, ...fields }) => {
        const data = await this.leadsService.updateLead(leadId, fields as CreateLeadDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'delete_lead',
      'Delete a lead by its ID. Optionally also delete the associated contact and/or company',
      {
        leadId: z.number().describe('The lead ID to delete'),
        deleteContact: z.boolean().optional().describe('Also delete the associated contact?'),
        deleteCompany: z.boolean().optional().describe('Also delete the associated company?'),
      },
      async ({ leadId, deleteContact, deleteCompany }) => {
        const data = await this.leadsService.deleteLead(leadId, { deleteContact, deleteCompany });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerCompanyWriteTools(server: McpServer) {
    server.tool(
      'create_company',
      'Create a new company in the CRM',
      {
        name: z.string().describe('Company name'),
        address: z.string().optional().describe('Company address'),
        addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
        type: z.enum(Object.values(CompanyType) as [string, ...string[]]).optional().describe('Company type'),
        serviceId: z.number().optional().describe('Service ID'),
        isCustomer: z.boolean().optional().describe('Is the company a customer?'),
        isClient: z.boolean().optional().describe('Is the company a client?'),
        notes: z.array(z.string()).optional().describe('Notes'),
        phone: z.string().optional().describe('Phone number'),
        email: z.string().optional().describe('Email address'),
      },
      async (fields) => {
        const data = await this.companiesService.create(fields as CreateCompanyDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        type: z.enum(Object.values(CompanyType) as [string, ...string[]]).optional().describe('Company type'),
        serviceId: z.number().optional().describe('Service ID'),
        isCustomer: z.boolean().optional().describe('Is the company a customer?'),
        isClient: z.boolean().optional().describe('Is the company a client?'),
        notes: z.array(z.string()).optional().describe('Notes (replaces all existing notes)'),
        phone: z.string().optional().describe('Phone number'),
        email: z.string().optional().describe('Email address'),
      },
      async ({ companyId, ...fields }) => {
        const data = await this.companiesService.update(companyId, fields as UpdateCompanyDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'delete_company',
      'Delete a company by its ID',
      { companyId: z.number().describe('The company ID to delete') },
      async ({ companyId }) => {
        await this.companiesService.delete(companyId);
        return { content: [{ type: 'text', text: JSON.stringify({ message: `Company ${companyId} deleted successfully` }) }] };
      },
    );
  }

  private registerContactWriteTools(server: McpServer) {
    server.tool(
      'delete_contact',
      'Delete a contact by its ID. Associated leads will have their contact reference cleared',
      { contactId: z.number().describe('The contact ID to delete') },
      async ({ contactId }) => {
        await this.contactsService.delete(contactId);
        return { content: [{ type: 'text', text: JSON.stringify({ message: `Contact ${contactId} deleted successfully` }) }] };
      },
    );

    server.tool(
      'create_contact',
      'Create a new contact in the CRM',
      {
        name: z.string().optional().describe('Contact name'),
        occupation: z.string().optional().describe('Occupation'),
        phone: z.string().optional().describe('Phone number'),
        email: z.string().optional().describe('Email address'),
        address: z.string().optional().describe('Address'),
        addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
        isCustomer: z.boolean().optional().describe('Is the contact a customer?'),
        isClient: z.boolean().optional().describe('Is the contact a client?'),
        companyId: z.number().optional().describe('Company ID to associate with'),
        notes: z.array(z.string()).optional().describe('Notes'),
      },
      async (fields) => {
        const data = await this.contactsService.create(fields as CreateContactDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'update_contact',
      'Update an existing contact by its ID. Only provided fields are updated',
      {
        contactId: z.number().describe('The contact ID to update'),
        name: z.string().optional().describe('Contact name'),
        occupation: z.string().optional().describe('Occupation'),
        phone: z.string().optional().describe('Phone number'),
        email: z.string().optional().describe('Email address'),
        address: z.string().optional().describe('Address'),
        addressLink: z.string().optional().describe('Address link'),
        isCustomer: z.boolean().optional().describe('Is the contact a customer?'),
        isClient: z.boolean().optional().describe('Is the contact a client?'),
        companyId: z.number().optional().describe('Company ID'),
        notes: z.array(z.string()).optional().describe('Notes (replaces all existing notes)'),
      },
      async ({ contactId, ...fields }) => {
        const data = await this.contactsService.update(contactId, fields as UpdateContactDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerProjectWriteTools(server: McpServer) {
    server.tool(
      'delete_project',
      'Delete a project by its ID. The associated lead is preserved',
      { projectId: z.number().describe('The project ID to delete') },
      async ({ projectId }) => {
        await this.projectsService.delete(projectId);
        return { content: [{ type: 'text', text: JSON.stringify({ message: `Project ${projectId} deleted successfully` }) }] };
      },
    );

    server.tool(
      'create_project',
      'Create a new project for an existing lead',
      {
        leadId: z.number().describe('Lead ID to associate the project with'),
        invoiceAmount: z.number().optional().describe('Invoice amount'),
        payments: z.array(z.number()).optional().describe('Payments made (array of amounts)'),
        projectProgressStatus: z.enum(Object.values(ProjectProgressStatus) as [string, ...string[]]).optional().describe('Project progress status'),
        invoiceStatus: z.enum(Object.values(InvoiceStatus) as [string, ...string[]]).optional().describe('Invoice status'),
        quickbooks: z.boolean().optional().describe('Is it registered in QuickBooks?'),
        overview: z.string().optional().describe('Project overview/description'),
        notes: z.array(z.string()).optional().describe('Project notes'),
      },
      async (fields) => {
        const data = await this.projectsService.create(fields as CreateProjectDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'update_project',
      'Update an existing project by its ID. Only provided fields are updated',
      {
        projectId: z.number().describe('The project ID to update'),
        invoiceAmount: z.number().optional().describe('Invoice amount'),
        payments: z.array(z.number()).optional().describe('Payments made (replaces all existing payments)'),
        projectProgressStatus: z.enum(Object.values(ProjectProgressStatus) as [string, ...string[]]).optional().describe('Project progress status'),
        invoiceStatus: z.enum(Object.values(InvoiceStatus) as [string, ...string[]]).optional().describe('Invoice status'),
        quickbooks: z.boolean().optional().describe('Is it registered in QuickBooks?'),
        overview: z.string().optional().describe('Project overview/description'),
        notes: z.array(z.string()).optional().describe('Project notes (replaces all existing notes)'),
      },
      async ({ projectId, ...fields }) => {
        const data = await this.projectsService.update(projectId, fields as UpdateProjectDto);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── Tier 2: per-project drill-down ────────────────────────────────────────

  private registerQboProjectTools(server: McpServer) {
    const realmIdParam = z.string().optional().describe(
      'QuickBooks company realm ID. Omit to use the default connected company.',
    );

    server.tool(
      'get_project_financials',
      'Aggregated financial summary for one or more project numbers from QuickBooks: ' +
        'estimated amount, invoiced amount, paid, outstanding, and payment percentage. ' +
        'Use get_project_detail for full transactions with line items.',
      {
        projectNumbers: z.array(z.string()).min(1).describe('Project numbers, e.g. ["001-0924"]'),
        realmId: realmIdParam,
      },
      async ({ projectNumbers, realmId }) => {
        const data = await this.qboFinancials.getProjectFinancials(projectNumbers, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_detail',
      'Full QuickBooks detail for one or more project numbers: the QBO job record, ' +
        'all Estimates with line items, all Invoices with line items, all Payments, ' +
        'and an aggregated financial summary.',
      {
        projectNumbers: z.array(z.string()).min(1).describe('Project numbers, e.g. ["001-0924"]'),
        realmId: realmIdParam,
      },
      async ({ projectNumbers, realmId }) => {
        const data = await this.qboFinancials.getProjectDetail(projectNumbers, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_invoices_by_project',
      'List all invoices for a project with number, date, amount, balance, due date, and derived status (Paid/Partial/Overdue/Pending).',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getInvoicesByProject(projectNumber, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_invoice_by_id',
      'Full invoice detail from QuickBooks by QBO invoice ID, including all line items.',
      {
        invoiceId: z.string().describe('QBO invoice ID'),
        realmId: realmIdParam,
      },
      async ({ invoiceId, realmId }) => {
        const data = await this.qboFinancials.getInvoiceById(invoiceId, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_estimates_by_project',
      'All estimates for a project with full line items, status (Pending/Accepted/Closed), and amounts.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getEstimatesByProject(projectNumber, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_estimate_by_id',
      'Full estimate detail from QuickBooks by QBO estimate ID, including all line items.',
      {
        estimateId: z.string().describe('QBO estimate ID'),
        realmId: realmIdParam,
      },
      async ({ estimateId, realmId }) => {
        const data = await this.qboFinancials.getEstimateById(estimateId, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_payments_by_project',
      'All payments received for a project with date, amount, payment method, and linked invoices.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getPaymentsByProject(projectNumber, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_unbilled_work',
      'Unbilled work for a project: total estimated minus total invoiced, ' +
        'with full estimate and invoice objects so line items can be compared. ' +
        'A positive unbilledAmount means work was quoted but not yet billed.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getUnbilledWork(projectNumber, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── Tier 4: company-wide QBO reports ──────────────────────────────────────

  private registerQboReportTools(server: McpServer) {
    const realmIdParam = z.string().optional().describe(
      'QuickBooks company realm ID. Omit to use the default connected company.',
    );

    server.tool(
      'get_aging_report',
      'Accounts receivable aging report: all open invoices bucketed by days overdue ' +
        '(Current, 1-30, 31-60, 61-90, 90+) with per-bucket totals and grand total outstanding.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const data = await this.qboReports.getAgingReport(realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_outstanding_balances',
      'All QuickBooks projects (jobs) with an open invoice balance, ' +
        'sorted by outstanding amount descending. Gives a quick view of who owes what.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const data = await this.qboReports.getOutstandingBalances(realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_unbilled_completed_work',
      'All QuickBooks jobs where estimated amount exceeds invoiced amount — ' +
        'work that has been quoted or contracted but not yet billed to the client. ' +
        'Sorted by backlog amount descending.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const data = await this.qboReports.getUnbilledCompletedWork(realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_revenue_by_period',
      'Total revenue collected (payments received) within a date range. ' +
        'Returns total amount, payment count, and full payment list.',
      {
        start: z.string().describe('Start date in YYYY-MM-DD format'),
        end: z.string().describe('End date in YYYY-MM-DD format'),
        realmId: realmIdParam,
      },
      async ({ start, end, realmId }) => {
        const data = await this.qboReports.getRevenueByPeriod(start, end, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_backlog',
      'All QuickBooks jobs with contracted (estimated) work that has not yet been invoiced. ' +
        'backlogAmount = estimatedAmount − invoicedAmount. Sorted descending.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const data = await this.qboReports.getBacklog(realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'search_projects_by_financial_criteria',
      'Filter QuickBooks jobs by financial thresholds. All criteria are optional. ' +
        'Examples: "all projects with outstanding > $5000", ' +
        '"projects where estimated > invoiced", ' +
        '"projects with invoiced between $10k and $50k".',
      {
        minOutstanding: z.number().optional().describe('Minimum open invoice balance'),
        maxOutstanding: z.number().optional().describe('Maximum open invoice balance'),
        minInvoiced: z.number().optional().describe('Minimum total invoiced amount'),
        maxInvoiced: z.number().optional().describe('Maximum total invoiced amount'),
        minEstimated: z.number().optional().describe('Minimum total estimated amount'),
        hasUnbilledWork: z.boolean().optional().describe('Only return projects where estimated > invoiced'),
        minUnbilledAmount: z.number().optional().describe('Minimum unbilled amount (estimated − invoiced)'),
        realmId: realmIdParam,
      },
      async ({ realmId, ...criteria }) => {
        const data = await this.qboReports.searchByFinancialCriteria(criteria, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_top_clients_by_revenue',
      'Top clients ranked by total invoiced amount, with paid vs outstanding breakdown.',
      {
        limit: z.number().optional().describe('Number of clients to return (default: 10)'),
        realmId: realmIdParam,
      },
      async ({ limit, realmId }) => {
        const data = await this.qboReports.getTopClientsByRevenue(limit ?? 10, realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── CRM-based reports (cross-system) ──────────────────────────────────────

  private registerQboCrmReports(server: McpServer) {
    const realmIdParam = z.string().optional().describe(
      'QuickBooks company realm ID. Omit to use the default connected company.',
    );

    server.tool(
      'get_pipeline_value',
      'Leads grouped by status with count per status. ' +
        'Gives a snapshot of the sales pipeline. ' +
        'Use get_project_financials on specific lead numbers to add monetary values.',
      {},
      async () => {
        const [allLeads, inReview] = await Promise.all([
          this.leadsService.getAllLeads(),
          this.leadsService.getLeadsInReview(),
        ]);
        const byStatus: Record<string, { count: number; leads: unknown[] }> = {};
        for (const lead of [...allLeads, ...inReview]) {
          const s = (lead as { status?: string }).status ?? 'UNKNOWN';
          if (!byStatus[s]) byStatus[s] = { count: 0, leads: [] };
          byStatus[s].count += 1;
          byStatus[s].leads.push(lead);
        }
        return { content: [{ type: 'text', text: JSON.stringify(byStatus) }] };
      },
    );

    server.tool(
      'get_win_rate',
      'Win rate: percentage of leads that were converted to a project. ' +
        'Based on CRM data (projects / total pipeline leads).',
      {},
      async () => {
        const [allLeads, inReview, projects] = await Promise.all([
          this.leadsService.getAllLeads(),
          this.leadsService.getLeadsInReview(),
          this.projectsService.findAll(),
        ]);
        const openLeads = allLeads.length + inReview.length;
        const won = projects.length;
        const total = openLeads + won;
        const winRate = total > 0 ? Math.round((won / total) * 10000) / 100 : 0;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ totalLeads: total, convertedToProject: won, openLeads, winRate }),
          }],
        };
      },
    );

    server.tool(
      'get_unbilled_completed_work_crm',
      'Projects with COMPLETED status in the CRM that have unbilled work in QuickBooks ' +
        '(estimated > invoiced). Combines CRM project data with QBO financials.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const completedProjects = await this.projectsService.findByStatus(
          ProjectProgressStatus.COMPLETED,
        );

        const leadNumbers = completedProjects
          .map((p: Record<string, unknown>) => {
            const lead = p['lead'] as { leadNumber?: string } | undefined;
            return lead?.leadNumber ?? null;
          })
          .filter(Boolean) as string[];

        if (!leadNumbers.length) {
          return { content: [{ type: 'text', text: JSON.stringify([]) }] };
        }

        const financials = await this.qboFinancials.getProjectFinancials(leadNumbers, realmId);
        const unbilled = financials.filter((f) => f.estimateVsInvoicedDelta > 0);

        const enriched = unbilled.map((f) => {
          const project = completedProjects.find(
            (p: Record<string, unknown>) =>
              (p['lead'] as { leadNumber?: string } | undefined)?.leadNumber === f.projectNumber,
          );
          return { ...f, crmProject: project };
        });

        return { content: [{ type: 'text', text: JSON.stringify(enriched) }] };
      },
    );

    server.tool(
      'get_top_clients_by_volume',
      'Top clients ranked by number of projects in the CRM.',
      {
        limit: z.number().optional().describe('Number of clients to return (default: 10)'),
      },
      async ({ limit = 10 }) => {
        const projects = await this.projectsService.findAll();
        const byClient: Record<string, { count: number; clientName: string; projects: unknown[] }> =
          {};

        for (const p of projects as Record<string, unknown>[]) {
          const contact = p['contact'] as { name?: string; id?: number } | undefined;
          const key = String(contact?.id ?? 'unknown');
          if (!byClient[key]) byClient[key] = { count: 0, clientName: contact?.name ?? key, projects: [] };
          byClient[key].count += 1;
          byClient[key].projects.push(p);
        }

        const sorted = Object.values(byClient)
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);

        return { content: [{ type: 'text', text: JSON.stringify(sorted) }] };
      },
    );
  }

  // ─── Tier 6: direct QBO proxy ───────────────────────────────────────────────

  private registerQboProxyTools(server: McpServer) {
    const realmIdParam = z.string().optional().describe(
      'QuickBooks company realm ID. Omit to use the default connected company.',
    );

    const resolveRealm = (realmId?: string): Promise<string> =>
      realmId ? Promise.resolve(realmId) : this.qboFinancials.getDefaultRealmId();

    server.tool(
      'qb_get_invoice',
      'Fetch a QuickBooks invoice directly by its QBO ID. Returns the full object including line items, customer, dates, and amounts.',
      {
        invoiceId: z.string().describe('QBO invoice ID'),
        realmId: realmIdParam,
      },
      async ({ invoiceId, realmId }) => {
        const rid = await resolveRealm(realmId);
        const data = await this.qboApi.getById(rid, 'invoice', invoiceId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const data = await this.qboApi.getById(rid, 'payment', paymentId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const data = await this.qboApi.getById(rid, 'customer', customerId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const data = await this.qboApi.getById(rid, 'estimate', estimateId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const data = await this.qboFinancials.getProjectDetail([projectNumber], realmId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerProjectTools(server: McpServer) {
    server.tool('get_all_projects', 'Get all projects from the CRM with lead and contact information', {}, async () => {
      const data = await this.projectsService.findAll();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_project_by_id',
      'Get a project by its numeric ID',
      { id: z.number().describe('The project ID') },
      async ({ id }) => {
        const data = await this.projectsService.findById(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_details',
      'Get full project details including lead, contact, and company information',
      { id: z.number().describe('The project ID') },
      async ({ id }) => {
        const data = await this.projectsService.getProjectDetails(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_by_lead_number',
      'Get a project by its associated lead number (e.g. 001-0425)',
      { leadNumber: z.string().describe('The lead number associated with the project') },
      async ({ leadNumber }) => {
        const data = await this.projectsService.findByLeadNumber(leadNumber);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_projects_by_status',
      `Get all projects filtered by progress status. Valid statuses: ${Object.values(ProjectProgressStatus).join(', ')}`,
      { status: z.enum(Object.values(ProjectProgressStatus) as [string, ...string[]]).describe('Project progress status to filter by') },
      async ({ status }) => {
        const data = await this.projectsService.findByStatus(status as ProjectProgressStatus);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_projects_by_contact_id',
      'Get all projects associated with a specific contact by their ID',
      { contactId: z.number().describe('The contact ID') },
      async ({ contactId }) => {
        const data = await this.projectsService.findByContactId(contactId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }
}
