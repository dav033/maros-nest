import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LeadsService } from '../leads/lead-management/leads.service';
import { CompaniesService } from '../companies/company-management/services/companies.service';
import { ContactsService } from '../contacts/contact-management/services/contacts.service';
import { ProjectsService } from '../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../quickbooks/services/financials/quickbooks-financials.service';
import { QuickbooksReportsService } from '../quickbooks/services/reports/quickbooks-reports.service';
import { QuickbooksApiService } from '../quickbooks/services/core/quickbooks-api.service';
import { QuickbooksJobCostingService } from '../quickbooks/services/job-costing/quickbooks-job-costing.service';
import { QuickbooksAttachmentsService } from '../quickbooks/services/attachments/quickbooks-attachments.service';
import { QuickbooksVendorMatchingService } from '../quickbooks/services/vendor/quickbooks-vendor-matching.service';
import { QuickbooksNormalizerService } from '../quickbooks/services/core/quickbooks-normalizer.service';
import {
  registerLeadTools,
  registerCompanyTools,
  registerContactTools,
  registerProjectTools,
} from './tools/crm-read';
import {
  registerLeadWriteTools,
  registerCompanyWriteTools,
  registerContactWriteTools,
  registerProjectWriteTools,
} from './tools/crm-write';
import { registerQboProjectTools } from './tools/qbo-project';
import { registerQboJobCostingTools } from './tools/qbo-job-costing';
import {
  registerQboVendorMatchingTools,
  registerQboAttachmentTools,
} from './tools/qbo-vendor-attachment';
import {
  registerQboReportTools,
  registerQboFinancialReportTools,
  registerQboCrmReports,
} from './tools/qbo-reports';
import { registerQboProxyTools } from './tools/qbo-proxy';
import { McpToolDeps } from './tools/shared';

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

    const deps: McpToolDeps = {
      leadsService: this.leadsService,
      companiesService: this.companiesService,
      contactsService: this.contactsService,
      projectsService: this.projectsService,
      qboFinancials: this.qboFinancials,
      qboReports: this.qboReports,
      qboApi: this.qboApi,
      qboJobCosting: this.qboJobCosting,
      qboAttachments: this.qboAttachments,
      qboVendorMatching: this.qboVendorMatching,
      qboNormalizer: this.qboNormalizer,
    };

    registerLeadTools(server, deps);
    registerLeadWriteTools(server, deps);
    registerCompanyTools(server, deps);
    registerCompanyWriteTools(server, deps);
    registerContactTools(server, deps);
    registerContactWriteTools(server, deps);
    registerProjectTools(server, deps);
    registerProjectWriteTools(server, deps);
    registerQboProjectTools(server, deps);
    registerQboJobCostingTools(server, deps);
    registerQboVendorMatchingTools(server, deps);
    registerQboAttachmentTools(server, deps);
    registerQboReportTools(server, deps);
    registerQboFinancialReportTools(server, deps);
    registerQboCrmReports(server, deps);
    registerQboProxyTools(server, deps);

    return server;
  }
}
