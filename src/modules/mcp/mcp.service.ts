import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LeadsService } from '../leads/services/leads.service';
import { CompaniesService } from '../companies/services/companies.service';
import { ContactsService } from '../contacts/services/contacts.service';
import { ProjectsService } from '../projects/services/projects.service';

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
    this.registerCompanyTools(server);
    this.registerContactTools(server);
    this.registerProjectTools(server);

    return server;
  }

  private registerLeadTools(server: McpServer) {
    server.tool('get_all_leads', 'Get all leads from the CRM', {}, async () => {
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
  }

  private registerCompanyTools(server: McpServer) {
    server.tool('get_all_companies', 'Get all companies from the CRM', {}, async () => {
      const data = await this.companiesService.findAll();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_company_by_id',
      'Get a company by its ID',
      { id: z.number().describe('The company ID') },
      async ({ id }) => {
        const data = await this.companiesService.findById(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerContactTools(server: McpServer) {
    server.tool('get_all_contacts', 'Get all contacts from the CRM', {}, async () => {
      const data = await this.contactsService.findAll();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_contact_by_id',
      'Get a contact by its ID',
      { id: z.number().describe('The contact ID') },
      async ({ id }) => {
        const data = await this.contactsService.getContactById(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contact_details',
      'Get full contact details including leads and projects',
      { id: z.number().describe('The contact ID') },
      async ({ id }) => {
        const data = await this.contactsService.getContactDetails(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_contacts_by_company',
      'Get all contacts belonging to a company',
      { companyId: z.number().describe('The company ID') },
      async ({ companyId }) => {
        const data = await this.contactsService.findByCompany(companyId);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }

  private registerProjectTools(server: McpServer) {
    server.tool('get_all_projects', 'Get all projects from the CRM', {}, async () => {
      const data = await this.projectsService.findAll();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    });

    server.tool(
      'get_project_by_id',
      'Get a project by its ID',
      { id: z.number().describe('The project ID') },
      async ({ id }) => {
        const data = await this.projectsService.findById(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_details',
      'Get full project details including lead and contact information',
      { id: z.number().describe('The project ID') },
      async ({ id }) => {
        const data = await this.projectsService.getProjectDetails(id);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );

    server.tool(
      'get_project_by_lead_number',
      'Get a project by its associated lead number',
      { leadNumber: z.string().describe('The lead number') },
      async ({ leadNumber }) => {
        const data = await this.projectsService.findByLeadNumber(leadNumber);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      },
    );
  }
}
