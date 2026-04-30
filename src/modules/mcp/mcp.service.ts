import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LeadsService } from '../leads/services/leads.service';
import { CompaniesService } from '../companies/services/companies.service';
import { ContactsService } from '../contacts/services/contacts.service';
import { ProjectsService } from '../projects/services/projects.service';
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
