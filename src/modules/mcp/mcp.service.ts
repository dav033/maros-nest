import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LeadsService } from '../leads/services/leads.service';
import { CompaniesService } from '../companies/services/companies.service';
import { ContactsService } from '../contacts/services/contacts.service';
import { ProjectsService } from '../projects/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/quickbooks-financials.service';
import {
  QuickbooksReportsService,
  ReportParams,
} from '../../quickbooks/services/quickbooks-reports.service';
import { QuickbooksApiService } from '../../quickbooks/services/quickbooks-api.service';
import { QuickbooksJobCostingService } from '../../quickbooks/services/quickbooks-job-costing.service';
import { QuickbooksAttachmentsService } from '../../quickbooks/services/quickbooks-attachments.service';
import { QuickbooksVendorMatchingService } from '../../quickbooks/services/quickbooks-vendor-matching.service';
import { QuickbooksNormalizerService } from '../../quickbooks/services/quickbooks-normalizer.service';
import { QboReauthorizationRequiredException } from '../../quickbooks/exceptions/qbo-reauthorization-required.exception';
import { CreateLeadDto } from '../leads/dto/create-lead.dto';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { UpdateContactDto } from '../contacts/dto/update-contact.dto';
import { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { UpdateCompanyDto } from '../companies/dto/update-company.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { LeadStatus } from '../../common/enums/lead-status.enum';
import { CompanyType } from '../../common/enums/company-type.enum';
import { ProjectProgressStatus } from '../../common/enums/project-progress-status.enum';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

type QboMcpPayload = {
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
  warnings: unknown[];
  coverage: Record<string, unknown>;
};

const QBO_TRANSACTION_TYPES = [
  'Invoice',
  'Estimate',
  'Payment',
  'Purchase',
  'Bill',
  'BillPayment',
  'VendorCredit',
  'PurchaseOrder',
  'JournalEntry',
] as const;

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
    private readonly qboJobCosting: QuickbooksJobCostingService,
    private readonly qboAttachments: QuickbooksAttachmentsService,
    private readonly qboVendorMatching: QuickbooksVendorMatchingService,
    private readonly qboNormalizer: QuickbooksNormalizerService,
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
    this.registerQboJobCostingTools(server);
    this.registerQboVendorMatchingTools(server);
    this.registerQboAttachmentTools(server);
    this.registerQboReportTools(server);
    this.registerQboFinancialReportTools(server);
    this.registerQboCrmReports(server);
    this.registerQboProxyTools(server);

    return server;
  }

  private registerLeadTools(server: McpServer) {
    server.tool(
      'get_all_leads',
      'Get all leads from the CRM (excludes leads with projects and in-review leads)',
      {},
      async () => {
        const data = await this.leadsService.getPipelineLeads();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

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

    server.tool(
      'get_leads_in_review',
      'Get all leads currently in review',
      {},
      async () => {
        const data = await this.leadsService.getLeadsInReview();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_leads_by_status',
      `Get all leads filtered by status. Valid statuses: ${Object.values(LeadStatus).join(', ')}`,
      {
        status: z
          .enum(Object.values(LeadStatus) as [string, ...string[]])
          .describe('Lead status to filter by'),
      },
      async ({ status }) => {
        const data = await this.leadsService.getLeadsByStatus(
          status as LeadStatus,
        );
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
      {
        name: z
          .string()
          .describe('Contact name to search for (partial match supported)'),
      },
      async ({ name }) => {
        const data = await this.leadsService.getLeadsByContactName(name);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const data = await this.leadsService.searchLeads(query);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerCompanyTools(server: McpServer) {
    server.tool(
      'get_all_companies',
      'Get all companies from the CRM',
      {},
      async () => {
        const data = await this.companiesService.findAll();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

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
      {
        type: z
          .enum(Object.values(CompanyType) as [string, ...string[]])
          .describe('Company type to filter by'),
      },
      async ({ type }) => {
        const data = await this.companiesService.findByType(
          type as CompanyType,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
          await this.companiesService.getCompanyWithContacts(idOrName);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
          await this.companiesService.getCompanyFullProfile(idOrName);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_customer_companies',
      'Get all companies marked as customers',
      {},
      async () => {
        const data = await this.companiesService.findCustomers();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_client_companies',
      'Get all companies marked as clients',
      {},
      async () => {
        const data = await this.companiesService.findClients();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerContactTools(server: McpServer) {
    server.tool(
      'get_all_contacts',
      'Get all contacts from the CRM with their company info',
      {},
      async () => {
        const data = await this.contactsService.findAll();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

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
      {
        query: z
          .string()
          .describe('Text to search in contact name, email, or phone'),
      },
      async ({ query }) => {
        const data = await this.contactsService.searchContacts(query);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_customer_contacts',
      'Get all contacts marked as customers',
      {},
      async () => {
        const data = await this.contactsService.findCustomers();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_client_contacts',
      'Get all contacts marked as clients',
      {},
      async () => {
        const data = await this.contactsService.findClients();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerLeadWriteTools(server: McpServer) {
    server.tool(
      'create_lead_with_existing_contact',
      'Create a new lead and associate it with an existing contact by contact ID',
      {
        contactId: z.number().describe('ID of the existing contact'),
        leadNumber: z
          .string()
          .optional()
          .describe('Lead number (auto-generated if omitted)'),
        name: z
          .string()
          .optional()
          .describe('Lead name (auto-generated if omitted)'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        location: z.string().optional().describe('Location'),
        addressLink: z
          .string()
          .optional()
          .describe('Address link (Google Maps URL)'),
        status: z
          .enum(Object.values(LeadStatus) as [string, ...string[]])
          .optional()
          .describe('Lead status'),
        projectTypeId: z.number().optional().describe('Project type ID'),
        notes: z.array(z.string()).optional().describe('Notes'),
        inReview: z
          .boolean()
          .optional()
          .describe('Whether the lead is in review'),
      },
      async ({ contactId, ...leadFields }) => {
        const lead: CreateLeadDto = leadFields as CreateLeadDto;
        const data = await this.leadsService.createLeadWithExistingContact(
          lead,
          contactId,
        );
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
        contact_occupation: z
          .string()
          .optional()
          .describe('Contact occupation'),
        contact_address: z.string().optional().describe('Contact address'),
        contact_companyId: z
          .number()
          .optional()
          .describe('Company ID for the contact'),
        contact_isCustomer: z
          .boolean()
          .optional()
          .describe('Is the contact a customer?'),
        contact_isClient: z
          .boolean()
          .optional()
          .describe('Is the contact a client?'),
        contact_notes: z.array(z.string()).optional().describe('Contact notes'),
        leadNumber: z
          .string()
          .optional()
          .describe('Lead number (auto-generated if omitted)'),
        name: z.string().optional().describe('Lead name'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        location: z.string().optional().describe('Location'),
        addressLink: z.string().optional().describe('Address link'),
        status: z
          .enum(Object.values(LeadStatus) as [string, ...string[]])
          .optional()
          .describe('Lead status'),
        projectTypeId: z.number().optional().describe('Project type ID'),
        notes: z.array(z.string()).optional().describe('Lead notes'),
        inReview: z
          .boolean()
          .optional()
          .describe('Whether the lead is in review'),
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
      }) => {
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
        const data = await this.leadsService.createLeadWithNewContact(
          lead,
          contact,
        );
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
        status: z
          .enum(Object.values(LeadStatus) as [string, ...string[]])
          .optional()
          .describe('Lead status'),
        projectTypeId: z.number().optional().describe('Project type ID'),
        notes: z
          .array(z.string())
          .optional()
          .describe('Notes (replaces all existing notes)'),
        inReview: z
          .boolean()
          .optional()
          .describe('Whether the lead is in review'),
      },
      async ({ leadId, ...fields }) => {
        const data = await this.leadsService.updateLead(
          leadId,
          fields as CreateLeadDto,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
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
      async ({ leadId, deleteContact, deleteCompany }) => {
        const data = await this.leadsService.deleteLead(leadId, {
          deleteContact,
          deleteCompany,
        });
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
        addressLink: z
          .string()
          .optional()
          .describe('Address link (Google Maps URL)'),
        type: z
          .enum(Object.values(CompanyType) as [string, ...string[]])
          .optional()
          .describe('Company type'),
        serviceId: z.number().optional().describe('Service ID'),
        isCustomer: z
          .boolean()
          .optional()
          .describe('Is the company a customer?'),
        isClient: z.boolean().optional().describe('Is the company a client?'),
        notes: z.array(z.string()).optional().describe('Notes'),
        phone: z.string().optional().describe('Phone number'),
        email: z.string().optional().describe('Email address'),
      },
      async (fields) => {
        const data = await this.companiesService.create(
          fields as CreateCompanyDto,
        );
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
        type: z
          .enum(Object.values(CompanyType) as [string, ...string[]])
          .optional()
          .describe('Company type'),
        serviceId: z.number().optional().describe('Service ID'),
        isCustomer: z
          .boolean()
          .optional()
          .describe('Is the company a customer?'),
        isClient: z.boolean().optional().describe('Is the company a client?'),
        notes: z
          .array(z.string())
          .optional()
          .describe('Notes (replaces all existing notes)'),
        phone: z.string().optional().describe('Phone number'),
        email: z.string().optional().describe('Email address'),
      },
      async ({ companyId, ...fields }) => {
        const data = await this.companiesService.update(
          companyId,
          fields as UpdateCompanyDto,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'delete_company',
      'Delete a company by its ID',
      { companyId: z.number().describe('The company ID to delete') },
      async ({ companyId }) => {
        await this.companiesService.delete(companyId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: `Company ${companyId} deleted successfully`,
              }),
            },
          ],
        };
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
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: `Contact ${contactId} deleted successfully`,
              }),
            },
          ],
        };
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
        addressLink: z
          .string()
          .optional()
          .describe('Address link (Google Maps URL)'),
        isCustomer: z
          .boolean()
          .optional()
          .describe('Is the contact a customer?'),
        isClient: z.boolean().optional().describe('Is the contact a client?'),
        companyId: z
          .number()
          .optional()
          .describe('Company ID to associate with'),
        notes: z.array(z.string()).optional().describe('Notes'),
      },
      async (fields) => {
        const data = await this.contactsService.create(
          fields as CreateContactDto,
        );
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
        isCustomer: z
          .boolean()
          .optional()
          .describe('Is the contact a customer?'),
        isClient: z.boolean().optional().describe('Is the contact a client?'),
        companyId: z.number().optional().describe('Company ID'),
        notes: z
          .array(z.string())
          .optional()
          .describe('Notes (replaces all existing notes)'),
      },
      async ({ contactId, ...fields }) => {
        const data = await this.contactsService.update(
          contactId,
          fields as UpdateContactDto,
        );
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
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: `Project ${projectId} deleted successfully`,
              }),
            },
          ],
        };
      },
    );

    server.tool(
      'create_project',
      'Create a new project for an existing lead',
      {
        leadId: z.number().describe('Lead ID to associate the project with'),
        invoiceAmount: z.number().optional().describe('Invoice amount'),
        payments: z
          .array(z.number())
          .optional()
          .describe('Payments made (array of amounts)'),
        projectProgressStatus: z
          .enum(Object.values(ProjectProgressStatus) as [string, ...string[]])
          .optional()
          .describe('Project progress status'),
        invoiceStatus: z
          .enum(Object.values(InvoiceStatus) as [string, ...string[]])
          .optional()
          .describe('Invoice status'),
        quickbooks: z
          .boolean()
          .optional()
          .describe('Is it registered in QuickBooks?'),
        overview: z
          .string()
          .optional()
          .describe('Project overview/description'),
        notes: z.array(z.string()).optional().describe('Project notes'),
      },
      async (fields) => {
        const data = await this.projectsService.create(
          fields as CreateProjectDto,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'update_project',
      'Update an existing project by its ID. Only provided fields are updated',
      {
        projectId: z.number().describe('The project ID to update'),
        invoiceAmount: z.number().optional().describe('Invoice amount'),
        payments: z
          .array(z.number())
          .optional()
          .describe('Payments made (replaces all existing payments)'),
        projectProgressStatus: z
          .enum(Object.values(ProjectProgressStatus) as [string, ...string[]])
          .optional()
          .describe('Project progress status'),
        invoiceStatus: z
          .enum(Object.values(InvoiceStatus) as [string, ...string[]])
          .optional()
          .describe('Invoice status'),
        quickbooks: z
          .boolean()
          .optional()
          .describe('Is it registered in QuickBooks?'),
        overview: z
          .string()
          .optional()
          .describe('Project overview/description'),
        notes: z
          .array(z.string())
          .optional()
          .describe('Project notes (replaces all existing notes)'),
      },
      async ({ projectId, ...fields }) => {
        const data = await this.projectsService.update(
          projectId,
          fields as UpdateProjectDto,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── Tier 2: per-project drill-down ────────────────────────────────────────

  private registerQboProjectTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
        'QuickBooks company realm ID. Omit to use the default connected company.',
      );

    server.tool(
      'get_project_financials',
      'Aggregated financial summary for one or more project numbers from QuickBooks: ' +
        'estimated amount, invoiced amount, paid, outstanding, and payment percentage. ' +
        'Use get_project_detail for normalized transactions with line items.',
      {
        projectNumbers: z
          .array(z.string())
          .min(1)
          .describe('Project numbers, e.g. ["001-0924"]'),
        realmId: realmIdParam,
      },
      async ({ projectNumbers, realmId }) => {
        const data = await this.qboFinancials.getProjectFinancials(
          projectNumbers,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_detail',
      'Full QuickBooks detail for one or more project numbers: the QBO job record, ' +
        'normalized Estimates with line items, normalized Invoices with line items, ' +
        'normalized Payments, and an aggregated financial summary.',
      {
        projectNumbers: z
          .array(z.string())
          .min(1)
          .describe('Project numbers, e.g. ["001-0924"]'),
        realmId: realmIdParam,
      },
      async ({ projectNumbers, realmId }) => {
        const data = await this.qboFinancials.getProjectDetail(
          projectNumbers,
          realmId,
        );
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
        const data = await this.qboFinancials.getInvoicesByProject(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_invoice_by_id',
      'Normalized invoice detail from QuickBooks by QBO invoice ID, including all line items.',
      {
        invoiceId: z.string().describe('QBO invoice ID'),
        realmId: realmIdParam,
      },
      async ({ invoiceId, realmId }) => {
        const data = await this.qboFinancials.getInvoiceById(
          invoiceId,
          realmId,
        );
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
        const data = await this.qboFinancials.getEstimatesByProject(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_estimate_by_id',
      'Normalized estimate detail from QuickBooks by QBO estimate ID, including all line items.',
      {
        estimateId: z.string().describe('QBO estimate ID'),
        realmId: realmIdParam,
      },
      async ({ estimateId, realmId }) => {
        const data = await this.qboFinancials.getEstimateById(
          estimateId,
          realmId,
        );
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
        const data = await this.qboFinancials.getPaymentsByProject(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_unbilled_work',
      'Unbilled work for a project: total estimated minus total invoiced, ' +
        'with normalized estimate and invoice transactions so line items can be compared. ' +
        'A positive unbilledAmount means work was quoted but not yet billed.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getUnbilledWork(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_expenses_by_project',
      'All vendor expenses (Purchases) charged against a project in QuickBooks. ' +
        'Returns vendor name, date, amount, payment type (Cash/CreditCard/Check), ' +
        'and account-based line items. These are the "Expense" rows in the QBO Transactions tab.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getExpensesByProject(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_attachments_by_project',
      'Files and documents attached to a QuickBooks project (job). ' +
        'Returns file name, size, content type, note, dates, and linked entity metadata. ' +
        'Temporary download URLs are intentionally not returned.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getAttachmentsByProject(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_profit_and_loss',
      'QuickBooks Profit & Loss report for a specific project. ' +
        'Breaks down Income, Cost of Goods Sold (by category: materials, subcontractors, etc.), ' +
        'and Expenses, and returns gross profit and net profit.',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getProjectProfitAndLoss(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_full_profile',
      'Complete QuickBooks data for a single project in one call: ' +
        'QBO job record, aggregated financial summary, normalized estimates with line items, ' +
        'normalized invoices with line items, normalized payments, normalized vendor expenses, ' +
        'all attachments, and the full Profit & Loss report. ' +
        'Use this when you need everything about a project. ' +
        'For lighter reads use the isolated tools (get_invoices_by_project, get_expenses_by_project, etc.).',
      {
        projectNumber: z.string().describe('Project number, e.g. "001-0924"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getProjectFullProfile(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerQboJobCostingTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
        'QuickBooks company realm ID. Omit to use the default connected company.',
      );
    const jobCostParams = {
      projectNumber: z
        .string()
        .optional()
        .describe('Project number, e.g. "001-0924"'),
      qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
      vendorId: z.string().optional().describe('QBO Vendor ID'),
      vendorName: z.string().optional().describe('QBO Vendor display name'),
      startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
      endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
      includeAttachments: z
        .boolean()
        .optional()
        .describe('Include attachment metadata. Defaults to true.'),
      includeAttachmentDownloadUrls: z
        .boolean()
        .optional()
        .describe(
          'Include temporary QBO attachment download URLs. Defaults to false.',
        ),
      includeRaw: z
        .boolean()
        .optional()
        .describe('Include raw QBO objects. Defaults to false.'),
      realmId: realmIdParam,
    };
    const projectAnalysisParams = {
      projectNumber: z
        .string()
        .optional()
        .describe('Project number, e.g. "001-0924"'),
      qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
      realmId: realmIdParam,
      startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
      endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
      includeAttachments: z
        .boolean()
        .default(true)
        .describe('Include attachment metadata. Defaults to true.'),
      includeReports: z
        .boolean()
        .default(true)
        .describe(
          'Include report bundle when dates are provided. Defaults to true.',
        ),
      includeRaw: z
        .boolean()
        .default(false)
        .describe('Include raw QBO objects. Defaults to false.'),
    };
    const projectCostParams = {
      projectNumber: z
        .string()
        .optional()
        .describe('Project number, e.g. "001-0924"'),
      qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
      realmId: realmIdParam,
      startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
      endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
      includeAttachments: z
        .boolean()
        .default(true)
        .describe('Include attachment metadata. Defaults to true.'),
      includeRaw: z
        .boolean()
        .default(false)
        .describe('Include raw QBO objects. Defaults to false.'),
    };

    server.tool(
      'qbo_get_project_job_cost_summary',
      'Obtiene resumen financiero completo de un proyecto: contrato/estimates, invoices, customer payments, cash out pagado, bills abiertas, vendor credits, purchase orders, P&L, attachments y utilidad estimada.',
      projectAnalysisParams,
      async (params) =>
        this.safeQboTool(() => this.buildProjectJobCostSummaryPayload(params)),
    );

    server.tool(
      'qbo_get_project_cash_out',
      'Lista cash out real del proyecto: purchases, checks, credit card purchases, bill payments, bills abiertas, vendor credits y journal adjustments separados por estado.',
      projectCostParams,
      async (params) =>
        this.safeQboTool(() => this.buildProjectCashOutPayload(params)),
    );

    server.tool(
      'qbo_get_project_ap_status',
      'Muestra cuentas por pagar abiertas del proyecto por vendor/subcontractor, aging, due date, balance y attachments.',
      projectCostParams,
      async (params) =>
        this.safeQboTool(() => this.buildProjectApStatusPayload(params)),
    );

    server.tool(
      'qbo_get_project_vendor_transactions',
      'Agrupa transacciones del proyecto por vendor/subcontractor, con total pagado, abierto, créditos, attachments y categorías.',
      {
        projectNumber: z
          .string()
          .optional()
          .describe('Project number, e.g. "001-0924"'),
        qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
        vendorId: z.string().optional().describe('QBO Vendor ID'),
        vendorName: z.string().optional().describe('QBO Vendor display name'),
        startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
        endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
        includeAttachments: z
          .boolean()
          .default(true)
          .describe('Include attachment metadata. Defaults to true.'),
        includeRaw: z
          .boolean()
          .default(false)
          .describe('Include raw QBO objects. Defaults to false.'),
        realmId: realmIdParam,
      },
      async (params) =>
        this.safeQboTool(() =>
          this.buildProjectVendorTransactionsPayload(params),
        ),
    );

    server.tool(
      'qbo_get_vendor_transactions',
      'Consulta transacciones por vendor/subcontractor, con o sin proyecto.',
      {
        vendorId: z.string().optional().describe('QBO Vendor ID'),
        vendorName: z.string().optional().describe('QBO Vendor display name'),
        projectNumber: z
          .string()
          .optional()
          .describe('Project number, e.g. "001-0924"'),
        qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
        startDate: z.string().optional().describe('Start date in YYYY-MM-DD'),
        endDate: z.string().optional().describe('End date in YYYY-MM-DD'),
        transactionTypes: z
          .array(z.enum(QBO_TRANSACTION_TYPES))
          .optional()
          .describe('Transaction types to include'),
        includeAttachments: z
          .boolean()
          .default(true)
          .describe('Include attachment metadata. Defaults to true.'),
        includeRaw: z
          .boolean()
          .default(false)
          .describe('Include raw QBO objects. Defaults to false.'),
        realmId: realmIdParam,
      },
      async (params) =>
        this.safeQboTool(() => this.buildVendorTransactionsPayload(params)),
    );

    server.tool(
      'qbo_get_transaction_attachments',
      'Trae attachments de una transacción específica.',
      {
        entityType: z
          .enum(QBO_TRANSACTION_TYPES)
          .describe('QBO transaction type'),
        entityId: z.string().describe('QBO transaction ID'),
        realmId: realmIdParam,
        includeDownloadUrl: z
          .boolean()
          .default(false)
          .describe('Include temporary download URL. Defaults to false.'),
      },
      async (params) =>
        this.safeQboTool(() => this.buildTransactionAttachmentsPayload(params)),
    );

    server.tool(
      'qbo_get_qbo_transaction_by_id',
      'Obtiene una transacción QBO específica normalizada por tipo e ID.',
      {
        entityType: z
          .enum(QBO_TRANSACTION_TYPES)
          .describe('QBO transaction type'),
        entityId: z.string().describe('QBO transaction ID'),
        realmId: realmIdParam,
        includeAttachments: z
          .boolean()
          .default(true)
          .describe('Include attachment metadata. Defaults to true.'),
        includeRaw: z
          .boolean()
          .default(false)
          .describe('Include raw QBO object. Defaults to false.'),
      },
      async (params) =>
        this.safeQboTool(() => this.buildTransactionByIdPayload(params)),
    );

    server.tool(
      'qbo_get_project_report_bundle',
      'Trae reportes financieros relevantes del proyecto en formato resumido y plano.',
      {
        projectNumber: z
          .string()
          .optional()
          .describe('Project number, e.g. "001-0924"'),
        qboCustomerId: z.string().optional().describe('QBO Customer/Job ID'),
        startDate: z.string().describe('Start date in YYYY-MM-DD'),
        endDate: z.string().describe('End date in YYYY-MM-DD'),
        accountingMethod: z
          .enum(['Cash', 'Accrual'])
          .optional()
          .describe('Accounting method'),
        includeRaw: z
          .boolean()
          .default(false)
          .describe('Include raw QBO report payloads. Defaults to false.'),
        realmId: realmIdParam,
      },
      async (params) =>
        this.safeQboTool(() => this.buildProjectReportBundlePayload(params)),
    );

    server.tool(
      'get_project_cash_out',
      'Project job costing: paid cash out, open A/P, committed purchase orders, vendor credits, and adjustments.',
      jobCostParams,
      async (params) => {
        const data = await this.qboJobCosting.getProjectCashOut(params);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_vendor_transactions',
      'Project vendor/subcontractor transactions from QuickBooks job costing.',
      jobCostParams,
      async (params) => {
        const data =
          await this.qboJobCosting.getProjectVendorTransactions(params);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_ap_status',
      'Project accounts payable status: open bills, bill payments, and vendor credits.',
      jobCostParams,
      async (params) => {
        const data = await this.qboJobCosting.getProjectApStatus(params);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_job_cost_summary',
      'Project job cost summary with vendor and category breakdowns.',
      jobCostParams,
      async (params) => {
        const data = await this.qboJobCosting.getProjectJobCostSummary(params);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_vendor_transactions',
      'QuickBooks vendor transactions across purchases, bills, bill payments, credits, purchase orders, and adjustments.',
      jobCostParams,
      async (params) => {
        const data = await this.qboJobCosting.getVendorTransactions(params);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private async buildProjectJobCostSummaryPayload(params: {
    projectNumber?: string;
    qboCustomerId?: string;
    realmId?: string;
    startDate?: string;
    endDate?: string;
    includeAttachments?: boolean;
    includeReports?: boolean;
    includeRaw?: boolean;
  }): Promise<QboMcpPayload> {
    const jobCost = await this.qboJobCosting.getProjectJobCostSummary(
      this.toJobCostParams(params),
    );
    if (!this.qboProjectFound(jobCost.project)) {
      return this.projectNotFoundPayload(params);
    }

    const warnings = [...this.warningArray(jobCost.warnings)];
    const profile = params.projectNumber
      ? await this.tryRead(
          () =>
            this.qboFinancials.getProjectFullProfile(
              params.projectNumber!,
              params.realmId,
            ),
          warnings,
          'project_profile_unavailable',
          'No se pudo traer el detalle completo del proyecto.',
        )
      : null;
    const reportBundle =
      params.includeReports !== false
        ? await this.getOptionalProjectReportBundle(
            params,
            this.projectCustomerId(jobCost.project),
            warnings,
          )
        : null;
    const profileRecord = this.asRecord(profile);
    const financials = this.asRecord(profileRecord['financials']);
    const jobSummary = this.asRecord(jobCost.summary);
    const estimatedProfit = this.money(
      this.numberValue(financials['estimatedAmount']) -
        this.numberValue(jobSummary['totalJobCost']),
    );

    return this.qboPayload(
      {
        status: 'ok',
        project: this.projectLabel(jobCost.project, params),
        contractAmount: this.nullableNumber(financials['estimatedAmount']),
        invoicedAmount: this.nullableNumber(financials['invoicedAmount']),
        paidAmount: this.nullableNumber(financials['paidAmount']),
        outstandingAmount: this.nullableNumber(financials['outstandingAmount']),
        cashOutPaid: jobSummary['cashOutPaid'] ?? 0,
        openAp: jobSummary['openAp'] ?? 0,
        committedPo: jobSummary['committedPo'] ?? 0,
        vendorCredits: jobSummary['vendorCredits'] ?? 0,
        totalJobCost: jobSummary['totalJobCost'] ?? 0,
        estimatedProfit,
        vendorCount: jobCost.vendorBreakdown.length,
      },
      {
        project: jobCost.project,
        contract: profile
          ? {
              financials: profileRecord['financials'],
              estimates: profileRecord['estimates'],
              invoices: profileRecord['invoices'],
              payments: profileRecord['payments'],
              attachments:
                params.includeAttachments === false
                  ? []
                  : profileRecord['attachments'],
            }
          : null,
        jobCost: {
          summary: jobCost.summary,
          vendorBreakdown: jobCost.vendorBreakdown,
          categoryBreakdown: jobCost.categoryBreakdown,
        },
        reports: reportBundle,
      },
      warnings,
      {
        ...this.asRecord(jobCost.coverage),
        profileIncluded: profile !== null,
        reportsIncluded: reportBundle !== null,
      },
    );
  }

  private async buildProjectCashOutPayload(params: {
    projectNumber?: string;
    qboCustomerId?: string;
    realmId?: string;
    startDate?: string;
    endDate?: string;
    includeAttachments?: boolean;
    includeRaw?: boolean;
  }): Promise<QboMcpPayload> {
    const result = await this.qboJobCosting.getProjectCashOut(
      this.toJobCostParams(params),
    );
    if (!this.qboProjectFound(result.project)) {
      return this.projectNotFoundPayload(params);
    }

    return this.qboPayload(
      {
        status: 'ok',
        project: this.projectLabel(result.project, params),
        ...this.asRecord(result.summary),
        transactionCount: result.transactions.length,
        vendorCount: result.vendorBreakdown.length,
      },
      {
        project: result.project,
        byStatus: this.groupTransactionsByClassification(result.transactions),
        transactions: result.transactions,
        vendorBreakdown: result.vendorBreakdown,
        categoryBreakdown: result.categoryBreakdown,
      },
      result.warnings,
      result.coverage,
    );
  }

  private async buildProjectApStatusPayload(params: {
    projectNumber?: string;
    qboCustomerId?: string;
    realmId?: string;
    startDate?: string;
    endDate?: string;
    includeAttachments?: boolean;
    includeRaw?: boolean;
  }): Promise<QboMcpPayload> {
    const result = await this.qboJobCosting.getProjectApStatus(
      this.toJobCostParams(params),
    );
    if (!this.qboProjectFound(result.project)) {
      return this.projectNotFoundPayload(params);
    }

    return this.qboPayload(
      {
        status: 'ok',
        project: this.projectLabel(result.project, params),
        openAp: result.summary.openAp,
        vendorCredits: result.summary.vendorCredits,
        openBillCount: result.openBills.length,
        vendorCount: result.vendorBreakdown.length,
      },
      {
        project: result.project,
        aging: this.buildApAging(result.openBills),
        openBills: result.openBills,
        billPayments: result.billPayments,
        vendorCredits: result.vendorCredits,
        vendorBreakdown: result.vendorBreakdown,
      },
      result.warnings,
      result.coverage,
    );
  }

  private async buildProjectVendorTransactionsPayload(params: {
    projectNumber?: string;
    qboCustomerId?: string;
    vendorId?: string;
    vendorName?: string;
    realmId?: string;
    startDate?: string;
    endDate?: string;
    includeAttachments?: boolean;
    includeRaw?: boolean;
  }): Promise<QboMcpPayload> {
    const realmId = await this.resolveQboRealmId(params.realmId);
    const vendorCheck = await this.findVendorForTool(
      realmId,
      params.vendorId,
      params.vendorName,
    );
    if (vendorCheck && !vendorCheck.found) {
      return this.vendorNotFoundPayload(params, vendorCheck.suggestions);
    }

    const result = await this.qboJobCosting.getProjectVendorTransactions(
      this.toJobCostParams({ ...params, realmId }),
    );
    if (!this.qboProjectFound(result.project)) {
      return this.projectNotFoundPayload(params);
    }

    return this.qboPayload(
      {
        status: 'ok',
        project: this.projectLabel(result.project, params),
        transactionCount: result.transactions.length,
        vendorCount: result.vendorBreakdown.length,
      },
      {
        project: result.project,
        byVendor: this.groupTransactionsByVendor(result.transactions),
        transactions: result.transactions,
        vendorBreakdown: result.vendorBreakdown,
      },
      result.warnings,
      result.coverage,
    );
  }

  private async buildVendorTransactionsPayload(params: {
    vendorId?: string;
    vendorName?: string;
    projectNumber?: string;
    qboCustomerId?: string;
    startDate?: string;
    endDate?: string;
    transactionTypes?: string[];
    includeAttachments?: boolean;
    includeRaw?: boolean;
    realmId?: string;
  }): Promise<QboMcpPayload> {
    const realmId = await this.resolveQboRealmId(params.realmId);
    const vendorCheck = await this.findVendorForTool(
      realmId,
      params.vendorId,
      params.vendorName,
    );
    if (vendorCheck && !vendorCheck.found) {
      return this.vendorNotFoundPayload(params, vendorCheck.suggestions);
    }

    const result = await this.qboJobCosting.getVendorTransactions(
      this.toJobCostParams({ ...params, realmId }),
    );
    if (
      (params.projectNumber || params.qboCustomerId) &&
      result.project &&
      !this.qboProjectFound(result.project)
    ) {
      return this.projectNotFoundPayload(params);
    }
    const transactions = this.filterTransactionsByTypes(
      this.arrayValue(result.transactions),
      params.transactionTypes,
    );

    return this.qboPayload(
      {
        status: 'ok',
        vendorId: params.vendorId ?? null,
        vendorName: params.vendorName ?? null,
        project:
          result.project !== undefined
            ? this.projectLabel(result.project, params)
            : null,
        transactionCount: transactions.length,
        ...this.summarizeJobTransactions(transactions),
      },
      {
        vendorFilter: result.vendorFilter,
        project: result.project ?? null,
        transactions,
        byStatus: this.groupTransactionsByClassification(transactions),
        categoryBreakdown: result.categoryBreakdown,
      },
      result.warnings,
      {
        ...this.asRecord(result.coverage),
        transactionTypes: params.transactionTypes ?? null,
      },
    );
  }

  private async buildTransactionAttachmentsPayload(params: {
    entityType: string;
    entityId: string;
    realmId?: string;
    includeDownloadUrl?: boolean;
  }): Promise<QboMcpPayload> {
    const realmId = await this.resolveQboRealmId(params.realmId);
    const result = await this.qboAttachments.getAttachmentsForEntity(
      realmId,
      params.entityType,
      params.entityId,
      { includeTempDownloadUrl: params.includeDownloadUrl === true },
    );

    return this.qboPayload(
      {
        status: 'ok',
        entityType: params.entityType,
        entityId: params.entityId,
        attachmentCount: result.attachments.length,
      },
      {
        entityRef: result.entityRef,
        attachments: result.attachments,
      },
      result.warnings,
      {
        entitiesChecked: 1,
        attachmentsFound: result.attachments.length,
        fallbackUsed: result.fallbackUsed,
        downloadUrlsIncluded: params.includeDownloadUrl === true,
      },
    );
  }

  private async buildTransactionByIdPayload(params: {
    entityType: string;
    entityId: string;
    realmId?: string;
    includeAttachments?: boolean;
    includeRaw?: boolean;
  }): Promise<QboMcpPayload> {
    const realmId = await this.resolveQboRealmId(params.realmId);
    const rawResponse = await this.qboApi.getById(
      realmId,
      params.entityType,
      params.entityId,
    );
    const raw = this.qboApi.unwrapQboEntity(rawResponse, params.entityType);
    if (!Object.keys(raw).length) {
      return this.transactionNotFoundPayload(params);
    }

    const transaction = this.normalizeQboTransaction(params.entityType, raw);
    const attachments =
      params.includeAttachments === false
        ? null
        : await this.qboAttachments.getAttachmentsForEntity(
            realmId,
            params.entityType,
            params.entityId,
          );

    return this.qboPayload(
      {
        status: 'ok',
        entityType: params.entityType,
        entityId: params.entityId,
        transactionDate: this.asRecord(transaction)['txnDate'] ?? null,
        totalAmount: this.asRecord(transaction)['totalAmount'] ?? null,
        attachmentCount: attachments?.attachments.length ?? 0,
      },
      {
        transaction,
        attachments: attachments?.attachments ?? [],
        ...(params.includeRaw === true && { raw }),
      },
      [
        ...this.warningArray(this.asRecord(transaction)['warnings']),
        ...this.warningArray(attachments?.warnings),
      ],
      {
        entityType: params.entityType,
        entityId: params.entityId,
        attachmentsRequested: params.includeAttachments !== false,
        attachmentsFound: attachments?.attachments.length ?? 0,
        fallbackUsed: attachments?.fallbackUsed ?? false,
      },
    );
  }

  private async buildProjectReportBundlePayload(params: {
    projectNumber?: string;
    qboCustomerId?: string;
    startDate: string;
    endDate: string;
    accountingMethod?: 'Cash' | 'Accrual';
    includeRaw?: boolean;
    realmId?: string;
  }): Promise<QboMcpPayload> {
    const realmId = await this.resolveQboRealmId(params.realmId);
    const project = await this.qboJobCosting.findProjectRefs({
      realmId,
      projectNumber: params.projectNumber,
      qboCustomerId: params.qboCustomerId,
    });
    if (!this.qboProjectFound(project)) {
      return this.projectNotFoundPayload(params);
    }

    const customerId = params.qboCustomerId ?? this.projectCustomerId(project);
    const reports = await this.qboReports.getProjectReportBundle({
      realmId,
      startDate: params.startDate,
      endDate: params.endDate,
      customerId,
      accountingMethod: params.accountingMethod,
      includeRaw: params.includeRaw,
    });

    return this.qboPayload(
      {
        status: 'ok',
        project: this.projectLabel(project, params),
        customerId: customerId ?? null,
        profitAndLossRows: reports.profitAndLoss.rows.length,
        profitAndLossDetailRows: reports.profitAndLossDetail.rows.length,
        vendorExpenseRows: reports.vendorExpenses.rows.length,
        agedPayableRows: reports.agedPayables.rows.length,
        vendorBalanceDetailRows: reports.vendorBalanceDetail.rows.length,
      },
      {
        project,
        reports: {
          profitAndLoss: reports.profitAndLoss,
          profitAndLossDetail: reports.profitAndLossDetail,
          vendorExpenses: reports.vendorExpenses,
          agedPayables: reports.agedPayables,
          vendorBalanceDetail: reports.vendorBalanceDetail,
        },
      },
      reports.warnings.map((message) => ({
        code: 'report_warning',
        message,
      })),
      reports.coverage,
    );
  }

  private async getOptionalProjectReportBundle(
    params: {
      realmId?: string;
      startDate?: string;
      endDate?: string;
      includeRaw?: boolean;
    },
    customerId: string | undefined,
    warnings: unknown[],
  ): Promise<unknown> {
    if (!params.startDate || !params.endDate || !customerId) {
      warnings.push({
        code: 'reports_not_included',
        message:
          'Para incluir reportes financieros envía startDate, endDate y un proyecto encontrado.',
      });
      return null;
    }

    return this.tryRead(
      () =>
        this.qboReports.getProjectReportBundle({
          realmId: params.realmId,
          startDate: params.startDate!,
          endDate: params.endDate!,
          customerId,
          includeRaw: params.includeRaw,
        }),
      warnings,
      'project_reports_unavailable',
      'No se pudieron traer los reportes financieros del proyecto.',
    );
  }

  private async safeQboTool(
    build: () => Promise<QboMcpPayload>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      return this.qboText(await build());
    } catch (error) {
      return this.qboText(this.qboErrorPayload(error));
    }
  }

  private qboText(payload: QboMcpPayload): {
    content: Array<{ type: 'text'; text: string }>;
  } {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: this.stableValue(payload.summary),
            details: this.stableValue(payload.details),
            warnings: this.stableValue(payload.warnings),
            coverage: this.stableValue(payload.coverage),
          }),
        },
      ],
    };
  }

  private qboPayload(
    summary: Record<string, unknown>,
    details: Record<string, unknown>,
    warnings: unknown,
    coverage: unknown,
  ): QboMcpPayload {
    return {
      summary,
      details,
      warnings: this.warningArray(warnings),
      coverage: this.asRecord(coverage),
    };
  }

  private qboErrorPayload(error: unknown): QboMcpPayload {
    const connectionIssue = this.isQboConnectionError(error);
    const code = connectionIssue
      ? 'qbo_connection_required'
      : 'qbo_query_failed';
    const message = connectionIssue
      ? 'QuickBooks no está conectado o necesita autorización.'
      : 'No se pudo consultar QuickBooks con esos datos.';

    return this.qboPayload(
      {
        status: 'error',
        code,
        message,
      },
      {
        suggestions: connectionIssue
          ? [
              'Conecta QuickBooks nuevamente antes de consultar información financiera.',
            ]
          : [
              'Revisa el proyecto, vendor, tipo de transacción o rango de fechas e intenta de nuevo.',
            ],
      },
      [{ code, message }],
      { completed: false },
    );
  }

  private projectNotFoundPayload(params: {
    projectNumber?: string;
    qboCustomerId?: string;
  }): QboMcpPayload {
    return this.qboPayload(
      {
        status: 'notFound',
        message: 'No encontré ese proyecto en QuickBooks.',
        projectNumber: params.projectNumber ?? null,
        qboCustomerId: params.qboCustomerId ?? null,
      },
      {
        suggestions: [
          'Busca el proyecto por número exacto.',
          'Si lo tienes, usa el qboCustomerId del job en QuickBooks.',
          'Revisa que el proyecto exista como Customer/Job en QuickBooks.',
        ],
      },
      [
        {
          code: 'project_not_found',
          message: 'No encontré ese proyecto en QuickBooks.',
        },
      ],
      { completed: true, notFound: true },
    );
  }

  private vendorNotFoundPayload(
    params: { vendorId?: string; vendorName?: string },
    suggestions: unknown[],
  ): QboMcpPayload {
    return this.qboPayload(
      {
        status: 'notFound',
        message: 'No encontré ese vendor en QuickBooks.',
        vendorId: params.vendorId ?? null,
        vendorName: params.vendorName ?? null,
      },
      {
        suggestions,
      },
      [
        {
          code: 'vendor_not_found',
          message: 'No encontré ese vendor en QuickBooks.',
        },
      ],
      { completed: true, notFound: true },
    );
  }

  private transactionNotFoundPayload(params: {
    entityType: string;
    entityId: string;
  }): QboMcpPayload {
    return this.qboPayload(
      {
        status: 'notFound',
        message: 'No encontré esa transacción en QuickBooks.',
        entityType: params.entityType,
        entityId: params.entityId,
      },
      {
        suggestions: [
          'Revisa el tipo de transacción.',
          'Confirma que el ID corresponde a esa entidad en QuickBooks.',
        ],
      },
      [
        {
          code: 'transaction_not_found',
          message: 'No encontré esa transacción en QuickBooks.',
        },
      ],
      { completed: true, notFound: true },
    );
  }

  private toJobCostParams(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...params,
      includeAttachments: params['includeAttachments'] !== false,
      includeAttachmentDownloadUrls: false,
      includeRaw: params['includeRaw'] === true,
    };
  }

  private async resolveQboRealmId(realmId?: string): Promise<string> {
    return realmId ?? (await this.qboFinancials.getDefaultRealmId());
  }

  private async findVendorForTool(
    realmId: string,
    vendorId?: string,
    vendorName?: string,
  ): Promise<{ found: boolean; suggestions: unknown[] } | null> {
    if (!vendorId && !vendorName) return null;
    const vendors = await this.qboVendorMatching.listQboVendors(realmId);
    const normalizedName = this.normalizeText(vendorName);
    const found = vendors.some((vendor) => {
      if (vendorId && vendor.vendorId === vendorId) return true;
      const vendorDisplay = this.normalizeText(vendor.displayName);
      return (
        !!normalizedName &&
        (vendorDisplay === normalizedName ||
          vendorDisplay.includes(normalizedName))
      );
    });
    const suggestions = vendors
      .filter((vendor) => {
        if (!normalizedName) return true;
        return this.normalizeText(vendor.displayName).includes(normalizedName);
      })
      .slice(0, 5)
      .map((vendor) => ({
        vendorId: vendor.vendorId,
        vendorName: vendor.displayName,
        email: vendor.email ?? null,
        phone: vendor.phone ?? null,
      }));

    return { found, suggestions };
  }

  private normalizeQboTransaction(
    entityType: string,
    raw: Record<string, unknown>,
  ): unknown {
    switch (entityType) {
      case 'Invoice':
        return this.qboNormalizer.normalizeInvoice(raw);
      case 'Estimate':
        return this.qboNormalizer.normalizeEstimate(raw);
      case 'Payment':
        return this.qboNormalizer.normalizePayment(raw);
      case 'Purchase':
        return this.qboNormalizer.normalizePurchase(raw);
      case 'Bill':
        return this.qboNormalizer.normalizeBill(raw);
      case 'BillPayment':
        return this.qboNormalizer.normalizeBillPayment(raw);
      case 'VendorCredit':
        return this.qboNormalizer.normalizeVendorCredit(raw);
      case 'PurchaseOrder':
        return this.qboNormalizer.normalizePurchaseOrder(raw);
      case 'JournalEntry':
        return this.qboNormalizer.normalizeJournalEntry(raw);
      default:
        return raw;
    }
  }

  private qboProjectFound(project: unknown): boolean {
    const p = this.asRecord(project);
    if (p['foundInQuickBooks'] === true) return true;
    if (p['found'] === true) return true;
    if (this.stringValue(p['qboCustomerId'])) return true;
    return this.arrayValue(p['refs']).some((ref) => {
      const r = this.asRecord(ref);
      return this.stringValue(r['value']);
    });
  }

  private projectCustomerId(project: unknown): string | undefined {
    const p = this.asRecord(project);
    const id = this.stringValue(p['qboCustomerId']);
    if (id) return id;
    const ref = this.arrayValue(p['refs'])
      .map((item) => this.asRecord(item))
      .find((item) => this.stringValue(item['value']));
    return ref ? this.stringValue(ref['value']) : undefined;
  }

  private projectLabel(
    project: unknown,
    fallback: { projectNumber?: string; qboCustomerId?: string },
  ): Record<string, unknown> {
    const p = this.asRecord(project);
    return {
      projectNumber: p['projectNumber'] ?? fallback.projectNumber ?? null,
      qboCustomerId:
        p['qboCustomerId'] ??
        fallback.qboCustomerId ??
        this.projectCustomerId(project) ??
        null,
      displayName: p['displayName'] ?? p['customerName'] ?? null,
    };
  }

  private groupTransactionsByClassification(
    transactions: unknown[],
  ): Record<string, unknown[]> {
    return transactions.reduce<Record<string, unknown[]>>((acc, txn) => {
      const key =
        this.stringValue(this.asRecord(txn)['classification']) || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(txn);
      return acc;
    }, {});
  }

  private groupTransactionsByVendor(
    transactions: unknown[],
  ): Record<string, unknown> {
    return transactions.reduce<Record<string, unknown>>((acc, txn) => {
      const t = this.asRecord(txn);
      const vendor = this.asRecord(t['vendor']);
      const vendorId = this.stringValue(vendor['value']) || 'unknown';
      const vendorName = this.stringValue(vendor['name']) || vendorId;
      if (!acc[vendorId]) {
        acc[vendorId] = {
          vendorId,
          vendorName,
          transactions: [],
          summary: this.emptyJobSummary(),
        };
      }
      this.arrayValue(this.asRecord(acc[vendorId])['transactions']).push(txn);
      const summary = this.asRecord(this.asRecord(acc[vendorId])['summary']);
      this.addTransactionToSummary(summary, t);
      return acc;
    }, {});
  }

  private buildApAging(openBills: unknown[]): Record<string, unknown> {
    const buckets = {
      current: this.emptyAgingBucket(),
      days1to30: this.emptyAgingBucket(),
      days31to60: this.emptyAgingBucket(),
      days61to90: this.emptyAgingBucket(),
      over90: this.emptyAgingBucket(),
    };
    const today = new Date();

    for (const bill of openBills) {
      const b = this.asRecord(bill);
      const dueDate = this.stringValue(b['dueDate']);
      const daysOverdue = dueDate
        ? Math.floor((today.getTime() - new Date(dueDate).getTime()) / 86400000)
        : 0;
      const balance = this.numberValue(
        b['openBalance'] ?? b['allocatedAmount'],
      );
      const item = {
        entityType: b['entityType'],
        entityId: b['entityId'],
        docNumber: b['docNumber'],
        vendor: b['vendor'],
        dueDate: dueDate || null,
        balance,
        daysOverdue: Math.max(0, daysOverdue),
      };
      const bucket =
        daysOverdue <= 0
          ? buckets.current
          : daysOverdue <= 30
            ? buckets.days1to30
            : daysOverdue <= 60
              ? buckets.days31to60
              : daysOverdue <= 90
                ? buckets.days61to90
                : buckets.over90;
      bucket.items.push(item);
      bucket.count += 1;
      bucket.totalBalance = this.money(bucket.totalBalance + balance);
    }

    return buckets;
  }

  private emptyAgingBucket(): {
    items: unknown[];
    count: number;
    totalBalance: number;
  } {
    return { items: [], count: 0, totalBalance: 0 };
  }

  private filterTransactionsByTypes(
    transactions: unknown[],
    transactionTypes?: string[],
  ): unknown[] {
    if (!transactionTypes?.length) return transactions;
    const allowed = new Set(transactionTypes);
    return transactions.filter((txn) =>
      allowed.has(this.stringValue(this.asRecord(txn)['entityType'])),
    );
  }

  private summarizeJobTransactions(
    transactions: unknown[],
  ): Record<string, number> {
    const summary = this.emptyJobSummary();
    for (const txn of transactions) {
      this.addTransactionToSummary(summary, this.asRecord(txn));
    }
    summary.totalJobCost = this.money(
      summary.cashOutPaid +
        summary.openAp +
        summary.committedPo +
        summary.adjustedCosts -
        summary.vendorCredits,
    );
    return summary;
  }

  private emptyJobSummary(): Record<string, number> {
    return {
      cashOutPaid: 0,
      openAp: 0,
      committedPo: 0,
      vendorCredits: 0,
      adjustedCosts: 0,
      totalJobCost: 0,
    };
  }

  private addTransactionToSummary(
    summary: Record<string, unknown>,
    txn: Record<string, unknown>,
  ): void {
    const amount = this.numberValue(txn['allocatedAmount']);
    switch (txn['classification']) {
      case 'cash_out_paid':
        summary['cashOutPaid'] = this.money(
          this.numberValue(summary['cashOutPaid']) + amount,
        );
        break;
      case 'open_ap':
        summary['openAp'] = this.money(
          this.numberValue(summary['openAp']) + amount,
        );
        break;
      case 'commitment':
        summary['committedPo'] = this.money(
          this.numberValue(summary['committedPo']) + amount,
        );
        break;
      case 'credit':
        summary['vendorCredits'] = this.money(
          this.numberValue(summary['vendorCredits']) + amount,
        );
        break;
      case 'adjustment':
        summary['adjustedCosts'] = this.money(
          this.numberValue(summary['adjustedCosts']) + amount,
        );
        break;
      default:
        break;
    }
    summary['totalJobCost'] = this.money(
      this.numberValue(summary['cashOutPaid']) +
        this.numberValue(summary['openAp']) +
        this.numberValue(summary['committedPo']) +
        this.numberValue(summary['adjustedCosts']) -
        this.numberValue(summary['vendorCredits']),
    );
  }

  private async tryRead<T>(
    read: () => Promise<T>,
    warnings: unknown[],
    code: string,
    message: string,
  ): Promise<T | null> {
    try {
      return await read();
    } catch {
      warnings.push({ code, message });
      return null;
    }
  }

  private warningArray(value: unknown): unknown[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((warning) =>
        typeof warning === 'string'
          ? { code: 'warning', message: warning }
          : warning,
      );
    }
    return [value];
  }

  private stableValue(value: unknown): unknown {
    if (Array.isArray(value))
      return value.map((item) => this.stableValue(item));
    if (value instanceof Date) return value.toISOString();
    if (value !== null && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          const child = (value as Record<string, unknown>)[key];
          if (child !== undefined) acc[key] = this.stableValue(child);
          return acc;
        }, {});
    }
    return value;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private stringValue(value: unknown): string {
    return value == null ? '' : String(value).trim();
  }

  private numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private nullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeText(value: unknown): string {
    return this.stringValue(value).toLowerCase().replace(/\s+/g, ' ');
  }

  private money(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private isQboConnectionError(error: unknown): boolean {
    if (error instanceof QboReauthorizationRequiredException) return true;
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('requires manual reauthorization') ||
      message.includes('QBO_REAUTHORIZATION_REQUIRED') ||
      message.includes('QuickBooks connection')
    );
  }

  private registerQboVendorMatchingTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
        'QuickBooks company realm ID. Omit to use the default connected company.',
      );
    const resolveRealmId = async (realmId?: string) =>
      realmId ?? (await this.qboFinancials.getDefaultRealmId());

    server.tool(
      'list_qbo_vendors',
      'Read-only list of QuickBooks vendors normalized for CRM supplier/subcontractor matching.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const rid = await resolveRealmId(realmId);
        const data = await this.qboVendorMatching.listQboVendors(rid);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const rid = await resolveRealmId(realmId);
        const data = await this.qboVendorMatching.matchCrmCompaniesToVendors(
          rid,
          options,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const rid = await resolveRealmId(realmId);
        const data = await this.qboVendorMatching.suggestVendorMatches(
          rid,
          companyId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_qbo_vendor_crm_map',
      'Read-only map from QuickBooks vendors to CRM suppliers/subcontractors for financial analysis.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const rid = await resolveRealmId(realmId);
        const data = await this.qboVendorMatching.getVendorCrmMap(rid);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerQboAttachmentTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
        'QuickBooks company realm ID. Omit to use the default connected company.',
      );

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
        const data = await this.qboAttachments.getProjectAttachments(params);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const rid = realmId ?? (await this.qboFinancials.getDefaultRealmId());
        const data = await this.qboAttachments.getAttachmentsForEntity(
          rid,
          entityType,
          entityId,
          { includeTempDownloadUrl },
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
        const rid = realmId ?? (await this.qboFinancials.getDefaultRealmId());
        const data = await this.qboAttachments.getAttachmentDownloadUrl(
          rid,
          attachableId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── Tier 4: company-wide QBO reports ──────────────────────────────────────

  private registerQboReportTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
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
        const data = await this.qboReports.getRevenueByPeriod(
          start,
          end,
          realmId,
        );
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
        minOutstanding: z
          .number()
          .optional()
          .describe('Minimum open invoice balance'),
        maxOutstanding: z
          .number()
          .optional()
          .describe('Maximum open invoice balance'),
        minInvoiced: z
          .number()
          .optional()
          .describe('Minimum total invoiced amount'),
        maxInvoiced: z
          .number()
          .optional()
          .describe('Maximum total invoiced amount'),
        minEstimated: z
          .number()
          .optional()
          .describe('Minimum total estimated amount'),
        hasUnbilledWork: z
          .boolean()
          .optional()
          .describe('Only return projects where estimated > invoiced'),
        minUnbilledAmount: z
          .number()
          .optional()
          .describe('Minimum unbilled amount (estimated − invoiced)'),
        realmId: realmIdParam,
      },
      async ({ realmId, ...criteria }) => {
        const data = await this.qboReports.searchByFinancialCriteria(
          criteria,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_top_clients_by_revenue',
      'Top clients ranked by total invoiced amount, with paid vs outstanding breakdown.',
      {
        limit: z
          .number()
          .optional()
          .describe('Number of clients to return (default: 10)'),
        realmId: realmIdParam,
      },
      async ({ limit, realmId }) => {
        const data = await this.qboReports.getTopClientsByRevenue(
          limit ?? 10,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── Tier 5: QBO financial reports (job costing, vendors, GL) ───────────────

  private registerQboFinancialReportTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
        'QuickBooks company realm ID. Omit to use the default connected company.',
      );

    const reportParamsSchema = {
      realmId: realmIdParam,
      startDate: z.string().describe('Start date in YYYY-MM-DD format'),
      endDate: z.string().describe('End date in YYYY-MM-DD format'),
      customerId: z
        .string()
        .optional()
        .describe(
          'QuickBooks customer/job ID to filter by (for project-scoped reports)',
        ),
      vendorId: z
        .string()
        .optional()
        .describe('QuickBooks vendor ID to filter by'),
      accountingMethod: z
        .enum(['Cash', 'Accrual'])
        .optional()
        .describe('Accounting method (default: company setting)'),
      summarizeColumnBy: z
        .string()
        .optional()
        .describe('Summarize columns by period, e.g. Month, Quarter, Year'),
      includeRaw: z
        .boolean()
        .optional()
        .describe('Include raw QBO JSON in response (default false)'),
    };

    const toParams = (args: {
      realmId?: string;
      startDate: string;
      endDate: string;
      customerId?: string;
      vendorId?: string;
      accountingMethod?: 'Cash' | 'Accrual';
      summarizeColumnBy?: string;
      includeRaw?: boolean;
    }): ReportParams => args;

    server.tool(
      'get_profit_and_loss_detail',
      'QuickBooks Profit & Loss Detail report for a date range. Returns a flat list of ' +
        'income/expense rows with section, group, account label, and amount. ' +
        'Optionally filter by customerId (QBO job ID) for a single project. ' +
        'Date ranges longer than 6 months are split automatically.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getProfitAndLossDetail(
          toParams(args),
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_cash_flow',
      'QuickBooks Cash Flow Statement for a date range. Shows operating, investing, and ' +
        'financing activities as parsed flat rows. Splits ranges > 6 months automatically.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getCashFlow(toParams(args));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_vendor_expenses',
      'QuickBooks Vendor Expenses report. Shows what has been spent per vendor in the ' +
        'given date range, parsed into flat rows with vendor name, category, and amount.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getVendorExpenses(toParams(args));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_vendor_balance',
      'QuickBooks Vendor Balance report (point-in-time as of endDate). ' +
        'Shows the outstanding balance owed to each vendor.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getVendorBalance(toParams(args));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_vendor_balance_detail',
      'QuickBooks Vendor Balance Detail report. Shows the individual bills and credits ' +
        'that make up each vendor balance for the given date range.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getVendorBalanceDetail(
          toParams(args),
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_aged_payables',
      'QuickBooks Aged Payables report (A/P aging, point-in-time as of endDate). ' +
        'Shows overdue bills grouped by vendor. Use to understand what the company owes.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getAgedPayables(toParams(args));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_aged_payable_detail',
      'QuickBooks Aged Payable Detail report. Drill-down of the A/P aging with ' +
        'individual bill lines per vendor.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getAgedPayableDetail(toParams(args));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_general_ledger_detail',
      'QuickBooks General Ledger Detail report for a date range. Returns every posted ' +
        'transaction line with account, date, entity, and amount. ' +
        'Can be filtered by customerId or vendorId. ' +
        'Long ranges are split into 6-month chunks automatically — use narrower ranges ' +
        'for faster responses.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getGeneralLedgerDetail(
          toParams(args),
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_profit_and_loss',
      'Profit & Loss report scoped to a single QuickBooks project (job). ' +
        'Returns income, COGS, expenses, gross profit, and net profit broken down by category. ' +
        'This is the existing summary P&L — for line-level detail use get_profit_and_loss_detail ' +
        'with the customerId parameter.',
      {
        projectNumber: z
          .string()
          .describe('Project / lead number, e.g. "C-001"'),
        realmId: realmIdParam,
      },
      async ({ projectNumber, realmId }) => {
        const data = await this.qboFinancials.getProjectProfitAndLoss(
          projectNumber,
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_report_bundle',
      'Comprehensive financial report bundle for a project or date range. ' +
        'Returns Profit & Loss (summary + detail), Vendor Expenses, Aged Payables, and ' +
        'Vendor Balance Detail — all parsed into flat rows ready for analysis. ' +
        'Pass customerId (QBO job ID) to scope reports to a single project. ' +
        'Ranges longer than 6 months are split and combined automatically. ' +
        'Includes a warnings array for any report that could not be fetched.',
      reportParamsSchema,
      async (args) => {
        const data = await this.qboReports.getProjectReportBundle(
          toParams(args),
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  // ─── CRM-based reports (cross-system) ──────────────────────────────────────

  private registerQboCrmReports(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
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
          this.leadsService.getPipelineLeads(),
          this.leadsService.getLeadsInReview(),
        ]);
        const byStatus: Record<string, { count: number; leads: unknown[] }> =
          {};
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
          this.leadsService.getPipelineLeads(),
          this.leadsService.getLeadsInReview(),
          this.projectsService.findAll(),
        ]);
        const openLeads = allLeads.length + inReview.length;
        const won = projects.length;
        const total = openLeads + won;
        const winRate = total > 0 ? Math.round((won / total) * 10000) / 100 : 0;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                totalLeads: total,
                convertedToProject: won,
                openLeads,
                winRate,
              }),
            },
          ],
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

        const financials = await this.qboFinancials.getProjectFinancials(
          leadNumbers,
          realmId,
        );
        const unbilled = financials.filter(
          (f) => f.estimateVsInvoicedDelta > 0,
        );

        const enriched = unbilled.map((f) => {
          const project = completedProjects.find(
            (p: Record<string, unknown>) =>
              (p['lead'] as { leadNumber?: string } | undefined)?.leadNumber ===
              f.projectNumber,
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
        limit: z
          .number()
          .optional()
          .describe('Number of clients to return (default: 10)'),
      },
      async ({ limit = 10 }) => {
        const projects = await this.projectsService.findAll();
        const byClient: Record<
          string,
          { count: number; clientName: string; projects: unknown[] }
        > = {};

        for (const p of projects as Record<string, unknown>[]) {
          const contact = p['contact'] as
            | { name?: string; id?: number }
            | undefined;
          const key = String(contact?.id ?? 'unknown');
          if (!byClient[key])
            byClient[key] = {
              count: 0,
              clientName: contact?.name ?? key,
              projects: [],
            };
          byClient[key].count += 1;
          byClient[key].projects.push(p);
        }

        const sorted = Object.values(byClient)
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);

        return { content: [{ type: 'text', text: JSON.stringify(sorted) }] };
      },
    );

    server.tool(
      'get_company_financial_snapshot',
      'Full financial overview of the entire company: reads every project from the CRM, ' +
        'fetches their QuickBooks financials in a single batch, and returns per-project numbers ' +
        '(estimated, invoiced, paid, outstanding) plus company-wide totals. ' +
        'Use this to understand the current financial state of the business at a glance. ' +
        'Projects not found in QuickBooks are flagged with found=false.',
      { realmId: realmIdParam },
      async ({ realmId }) => {
        const allProjects = (await this.projectsService.findAll()) as Record<
          string,
          unknown
        >[];

        const projectsWithLeadNumbers = allProjects.map((p) => ({
          projectId: p['id'],
          leadNumber:
            (p['lead'] as { leadNumber?: string } | undefined)?.leadNumber ??
            null,
          contactName:
            (p['contact'] as { name?: string } | undefined)?.name ?? null,
          companyName:
            (
              (p['contact'] as Record<string, unknown> | undefined)?.[
                'company'
              ] as { name?: string } | undefined
            )?.name ?? null,
          projectProgressStatus: p['projectProgressStatus'],
          invoiceStatus: p['invoiceStatus'],
        }));

        const leadNumbers = projectsWithLeadNumbers
          .map((p) => p.leadNumber)
          .filter(Boolean) as string[];

        const financials = leadNumbers.length
          ? await this.qboFinancials.getProjectFinancials(leadNumbers, realmId)
          : [];

        const finMap = new Map(financials.map((f) => [f.projectNumber, f]));

        const projects = projectsWithLeadNumbers.map((p) => {
          const fin = p.leadNumber ? (finMap.get(p.leadNumber) ?? null) : null;
          return {
            ...p,
            qbo: fin
              ? {
                  found: fin.found,
                  estimatedAmount: fin.estimatedAmount,
                  invoicedAmount: fin.invoicedAmount,
                  paidAmount: fin.paidAmount,
                  outstandingAmount: fin.outstandingAmount,
                  paidPercentage: fin.paidPercentage,
                  estimateVsInvoicedDelta: fin.estimateVsInvoicedDelta,
                }
              : null,
          };
        });

        const totals = {
          totalProjects: projects.length,
          foundInQbo: projects.filter((p) => p.qbo?.found).length,
          notFoundInQbo: projects.filter((p) => !p.qbo?.found).length,
          totalEstimated: projects.reduce(
            (s, p) => s + (p.qbo?.estimatedAmount ?? 0),
            0,
          ),
          totalInvoiced: projects.reduce(
            (s, p) => s + (p.qbo?.invoicedAmount ?? 0),
            0,
          ),
          totalPaid: projects.reduce((s, p) => s + (p.qbo?.paidAmount ?? 0), 0),
          totalOutstanding: projects.reduce(
            (s, p) => s + (p.qbo?.outstandingAmount ?? 0),
            0,
          ),
          totalUnbilled: projects.reduce(
            (s, p) => s + Math.max(0, p.qbo?.estimateVsInvoicedDelta ?? 0),
            0,
          ),
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify({ totals, projects }) },
          ],
        };
      },
    );
  }

  // ─── Tier 6: direct QBO proxy ───────────────────────────────────────────────

  private registerQboProxyTools(server: McpServer) {
    const realmIdParam = z
      .string()
      .optional()
      .describe(
        'QuickBooks company realm ID. Omit to use the default connected company.',
      );

    const resolveRealm = (realmId?: string): Promise<string> =>
      realmId
        ? Promise.resolve(realmId)
        : this.qboFinancials.getDefaultRealmId();

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
        const data = await this.qboFinancials.getProjectDetail(
          [projectNumber],
          realmId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerProjectTools(server: McpServer) {
    server.tool(
      'get_all_projects',
      'Get all projects from the CRM with lead and contact information',
      {},
      async () => {
        const data = await this.projectsService.findAll();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

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
      {
        leadNumber: z
          .string()
          .describe('The lead number associated with the project'),
      },
      async ({ leadNumber }) => {
        const data = await this.projectsService.findByLeadNumber(leadNumber);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_projects_by_status',
      `Get all projects filtered by progress status. Valid statuses: ${Object.values(ProjectProgressStatus).join(', ')}`,
      {
        status: z
          .enum(Object.values(ProjectProgressStatus) as [string, ...string[]])
          .describe('Project progress status to filter by'),
      },
      async ({ status }) => {
        const data = await this.projectsService.findByStatus(
          status as ProjectProgressStatus,
        );
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
