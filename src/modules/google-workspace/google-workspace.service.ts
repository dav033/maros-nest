import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AttachmentSourceService, AttachmentSpec } from './attachment-source.service';
import { DriveFilesService, DriveSearchInput, DriveSearchResult, DriveUploadResult } from './drive-files.service';
import { GmailInvoiceImportService, ImportInput, ImportReport } from './gmail-invoice-import.service';
import { DraftResult, GmailDraftsService } from './gmail-drafts.service';
import { buildInvoiceFileName } from './invoice-file-name';
import {
  ALLOWED_CONTENT_TYPES,
  appendDate,
  decodeBase64,
  MAX_REPORT_BYTES,
  safeName,
  todayInCompanyZone,
} from './workspace-input';

export interface CreateDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentSpec[];
}

export interface SaveReportInput {
  name: string;
  contentType: string;
  /** Exactly one of `text` and `contentBase64`. */
  text?: string;
  contentBase64?: string;
  /** Sub-folders under `Maros/Reports`, e.g. ['064P-0826']. */
  folder?: string[];
  /** Stable identity: saving the same key to the same folder twice stores it once. */
  key?: string;
  /** Put the date before the extension: `weekly-report.pdf` -> `weekly-report-2026-11-08.pdf`. */
  addDate?: boolean;
  /** YYYY-MM-DD to use with `addDate`; today (US Eastern) when omitted. */
  date?: string;
}

export interface SaveReceiptInput {
  invoiceScanId: string;
  /** Overrides the project number stored on the scan. */
  project?: string;
  /** Overrides the vendor read from the invoice. */
  vendor?: string;
  /** Overrides the invoice total. */
  amount?: number;
}

/**
 * The three Google operations Maros processes need, each acting as a given
 * connected person. Drafts are never sent; Drive writes stay inside the
 * `Maros` folder the app owns.
 */
@Injectable()
export class GoogleWorkspaceService {
  constructor(
    private readonly drafts: GmailDraftsService,
    private readonly drive: DriveFilesService,
    private readonly attachments: AttachmentSourceService,
    private readonly gmailImport: GmailInvoiceImportService,
  ) {}

  /** Read-only Drive search as that person (whole Drive with drive.readonly). */
  searchDriveFiles(user: AuthenticatedUser, input: DriveSearchInput): Promise<DriveSearchResult> {
    return this.drive.search(user.id, input);
  }

  /** Reads the emails of ONE Gmail label and stores their invoice attachments in Drive. */
  async importGmailInvoices(user: AuthenticatedUser, input: ImportInput): Promise<ImportReport> {
    this.requirePermission(user, 'finance:write', 'importar facturas desde Gmail');
    return this.gmailImport.importLabel(user.id, input);
  }

  async createDraftWithAttachment(user: AuthenticatedUser, input: CreateDraftInput): Promise<DraftResult> {
    const specs = input.attachments ?? [];
    if (specs.some((spec) => spec.kind === 'invoice_scan')) {
      this.requirePermission(user, 'finance:read', 'adjuntar facturas');
    }
    const attachments = await this.attachments.resolveAll(user.id, specs);
    return this.drafts.createDraft(user.id, {
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments,
    });
  }

  async saveReportToDrive(user: AuthenticatedUser, input: SaveReportInput): Promise<DriveUploadResult> {
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
      throw new BadRequestException(`Tipo de archivo no permitido: ${input.contentType}.`);
    }
    const hasText = typeof input.text === 'string';
    const hasBinary = typeof input.contentBase64 === 'string';
    if (hasText === hasBinary) {
      throw new BadRequestException('Indica el contenido como text o como contentBase64, no ambos ni ninguno.');
    }
    const content = hasText
      ? Buffer.from(input.text as string, 'utf8')
      : this.decode(input.contentBase64 as string);
    if (content.length === 0) throw new BadRequestException('El informe está vacío.');
    if (content.length > MAX_REPORT_BYTES) {
      throw new BadRequestException(`El informe supera el máximo de ${MAX_REPORT_BYTES / 1024 / 1024} MB.`);
    }

    return this.drive.upload(user.id, {
      folderPath: ['Reports', ...(input.folder ?? [])],
      name: input.addDate ? appendDate(safeName(input.name), input.date ?? todayInCompanyZone()) : input.name,
      mimeType: input.contentType,
      content,
      key: input.key ? `report:${input.key}` : undefined,
      avoidOverwrite: true,
    });
  }

  async saveInvoiceToReceipts(user: AuthenticatedUser, input: SaveReceiptInput): Promise<DriveUploadResult> {
    this.requirePermission(user, 'finance:write', 'archivar facturas en Drive');
    const file = await this.attachments.loadInvoiceFile(input.invoiceScanId);
    const { scan } = file;
    const data = scan.extractedData;
    const projectNumber = input.project ?? scan.projectNumber;

    const named = buildInvoiceFileName({
      project: projectNumber,
      vendor: input.vendor ?? data?.counterpartyName,
      amount: input.amount ?? data?.total,
      currency: data?.currency,
      fileName: scan.fileName,
      contentType: file.contentType,
    });
    if (named.name === null) {
      throw new BadRequestException(
        `No se puede nombrar la factura (Proyecto-Proveedor-Valor): faltan ${named.missing.join(', ')}. ` +
          'Complétalo en el document scan o pásalo como project, vendor o amount. No se guardó nada.',
      );
    }

    return this.drive.upload(user.id, {
      folderPath: ['Receipts', safeName(projectNumber as string)],
      name: named.name,
      mimeType: file.contentType,
      content: file.content,
      key: `invoice_scan:${scan.id}`,
      avoidOverwrite: true,
    });
  }

  private requirePermission(user: AuthenticatedUser, code: 'finance:read' | 'finance:write', action: string): void {
    if (!user.permissions.includes(code)) {
      throw new ForbiddenException(`${user.email} no tiene el permiso ${code} necesario para ${action}.`);
    }
  }

  private decode(contentBase64: string): Buffer {
    try {
      return decodeBase64(contentBase64, MAX_REPORT_BYTES);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Contenido inválido.');
    }
  }
}
