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
import { InvoiceScansService } from '../quickbooks/services/invoice-scans.service';
import { S3Service } from '../s3/services/s3.service';
import { TasksService } from '../tasks/task-management/tasks.service';
import { TaskCommentsService } from '../tasks/task-management/services/task-comments.service';
import { UsersService } from '../users/user-management/users.service';
import { RolesService } from '../users/user-management/services/roles.service';
import { UserInvitationsService } from '../users/user-management/services/user-invitations.service';
import { QuickbooksProjectImportService } from '../projects/project-management/services/quickbooks-project-import.service';
import { ProjectQboReportService } from '../projects/project-management/services/project-qbo-report.service';
import { QuickbooksConnectionStatusService } from '../quickbooks/services/core/quickbooks-connection-status.service';
import { TaskLabelsService } from '../tasks/task-management/services/task-labels.service';
import { TaskTemplatesService } from '../tasks/task-management/services/task-templates.service';
import { TaskWorkspacesService } from '../task-workspaces/services/task-workspaces.service';
import { TaskWorkspaceFoldersService } from '../task-workspaces/services/task-workspace-folders.service';
import { TaskWorkspaceAssignmentService } from '../task-workspaces/services/task-workspace-assignment.service';
import { McpActorService } from './mcp-actor.service';
import { TrelloService } from '../trello/services/trello.service';
import { NotesService } from '../notes/note-management/notes.service';
import { NoteTagsService } from '../notes/note-management/services/note-tags.service';
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
import { registerInvoiceScanTools } from './tools/invoice-scans';
import { registerTaskTools } from './tools/tasks';
import { registerUserTools } from './tools/users';
import { registerQboImportTools } from './tools/qbo-import';
import { registerTaskWorkspaceTools } from './tools/task-workspaces';
import { registerS3Tools } from './tools/s3';
import { registerTrelloTools } from './tools/trello';
import { registerNoteTools } from './tools/notes';
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
    private readonly invoiceScansService: InvoiceScansService,
    private readonly s3Service: S3Service,
    private readonly trelloService: TrelloService,
    private readonly notesService: NotesService,
    private readonly noteTagsService: NoteTagsService,
    private readonly tasksService: TasksService,
    private readonly taskCommentsService: TaskCommentsService,
    private readonly taskLabelsService: TaskLabelsService,
    private readonly taskTemplatesService: TaskTemplatesService,
    private readonly taskWorkspacesService: TaskWorkspacesService,
    private readonly taskWorkspaceFolders: TaskWorkspaceFoldersService,
    private readonly taskWorkspaceAssignment: TaskWorkspaceAssignmentService,
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly userInvitationsService: UserInvitationsService,
    private readonly qboProjectImport: QuickbooksProjectImportService,
    private readonly projectQboReport: ProjectQboReportService,
    private readonly qboConnectionStatus: QuickbooksConnectionStatusService,
    private readonly mcpActor: McpActorService,
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
      invoiceScansService: this.invoiceScansService,
      s3Service: this.s3Service,
      trelloService: this.trelloService,
      notesService: this.notesService,
      noteTagsService: this.noteTagsService,
      tasksService: this.tasksService,
      taskCommentsService: this.taskCommentsService,
      taskLabelsService: this.taskLabelsService,
      taskTemplatesService: this.taskTemplatesService,
      taskWorkspacesService: this.taskWorkspacesService,
      taskWorkspaceFolders: this.taskWorkspaceFolders,
      taskWorkspaceAssignment: this.taskWorkspaceAssignment,
      usersService: this.usersService,
      rolesService: this.rolesService,
      userInvitationsService: this.userInvitationsService,
      qboProjectImport: this.qboProjectImport,
      projectQboReport: this.projectQboReport,
      qboConnectionStatus: this.qboConnectionStatus,
      mcpActor: this.mcpActor,
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
    registerInvoiceScanTools(server, deps);
    registerS3Tools(server, deps);
    registerTrelloTools(server, deps);
    registerNoteTools(server, deps);
    registerTaskTools(server, deps);
    registerUserTools(server, deps);
    registerQboImportTools(server, deps);
    registerTaskWorkspaceTools(server, deps);

    return server;
  }
}
