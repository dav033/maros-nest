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
};

export function jsonContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}
