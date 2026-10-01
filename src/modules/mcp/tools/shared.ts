import { LeadsService } from '../../leads/lead-management/leads.service';
import { CompaniesService } from '../../companies/company-management/services/companies.service';
import { ContactsService } from '../../contacts/contact-management/services/contacts.service';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { QuickbooksFinancialsService } from '../../quickbooks/services/financials/quickbooks-financials.service';
import { QuickbooksReportsService } from '../../quickbooks/services/reports/quickbooks-reports.service';
import { QuickbooksApiService } from '../../quickbooks/services/core/quickbooks-api.service';
import { QuickbooksJobCostingService } from '../../quickbooks/services/job-costing/quickbooks-job-costing.service';
import { QuickbooksAttachmentsService } from '../../quickbooks/services/attachments/quickbooks-attachments.service';
import { QuickbooksVendorMatchingService } from '../../quickbooks/services/vendor/quickbooks-vendor-matching.service';
import { QuickbooksNormalizerService } from '../../quickbooks/services/core/quickbooks-normalizer.service';
import { InvoiceScansService } from '../../quickbooks/services/invoice-scans.service';
import { S3Service } from '../../s3/services/s3.service';
import { TrelloService } from '../../trello/services/trello.service';
import { NotesService } from '../../notes/note-management/notes.service';
import { TasksService } from '../../tasks/task-management/tasks.service';
import { TaskCommentsService } from '../../tasks/task-management/services/task-comments.service';
import { UsersService } from '../../users/user-management/users.service';
import { RolesService } from '../../users/user-management/services/roles.service';
import { UserInvitationsService } from '../../users/user-management/services/user-invitations.service';
import { McpActorService } from '../mcp-actor.service';
import { NoteTagsService } from '../../notes/note-management/services/note-tags.service';

export type QboMcpPayload = {
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
  warnings: unknown[];
  coverage: Record<string, unknown>;
};

export const QBO_TRANSACTION_TYPES = [
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

export type McpToolDeps = {
  leadsService: LeadsService;
  companiesService: CompaniesService;
  contactsService: ContactsService;
  projectsService: ProjectsService;
  qboFinancials: QuickbooksFinancialsService;
  qboReports: QuickbooksReportsService;
  qboApi: QuickbooksApiService;
  qboJobCosting: QuickbooksJobCostingService;
  qboAttachments: QuickbooksAttachmentsService;
  qboVendorMatching: QuickbooksVendorMatchingService;
  qboNormalizer: QuickbooksNormalizerService;
  invoiceScansService: InvoiceScansService;
  s3Service: S3Service;
  trelloService: TrelloService;
  notesService: NotesService;
  noteTagsService: NoteTagsService;
  tasksService: TasksService;
  taskCommentsService: TaskCommentsService;
  usersService: UsersService;
  rolesService: RolesService;
  userInvitationsService: UserInvitationsService;
  /** Quien firma las escrituras: el MCP no tiene sesion de persona. */
  mcpActor: McpActorService;
};

export function jsonContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}
