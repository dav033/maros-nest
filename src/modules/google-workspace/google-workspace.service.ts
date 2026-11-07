import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AttachmentSourceService, AttachmentSpec } from './attachment-source.service';
import { DriveFilesService, DriveUploadResult } from './drive-files.service';
import { DraftResult, GmailDraftsService } from './gmail-drafts.service';
import {
  ALLOWED_CONTENT_TYPES,
  decodeBase64,
  extensionFor,
  MAX_REPORT_BYTES,
  safeName,
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
}

export interface SaveReceiptInput {
  invoiceScanId: string;
  /** Overrides the project number stored on the scan. */
  project?: string;
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
  ) {}

  async createDraftWithAttachment(user: AuthenticatedUser, input: CreateDraftInput): Promise<DraftResult> {
    const specs = input.attachments ?? [];
    if (specs.some((spec) => spec.kind === 'invoice_scan')) {
      this.requirePermission(user, 'finance:read', 'adjuntar facturas');
    }
    const attachments = await this.attachments.resolveAll(specs);
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
      name: input.name,
      mimeType: input.contentType,
      content,
      key: input.key ? `report:${input.key}` : undefined,
    });
  }

  async saveInvoiceToReceipts(user: AuthenticatedUser, input: SaveReceiptInput): Promise<DriveUploadResult> {
    this.requirePermission(user, 'finance:write', 'archivar facturas en Drive');
    const file = await this.attachments.loadInvoiceFile(input.invoiceScanId);
    const { scan } = file;
    const data = scan.extractedData;
    const project = safeName(input.project ?? scan.projectNumber ?? 'Unassigned');

    const parts = [data?.issueDate ?? 'undated', data?.counterpartyName, data?.invoiceNumber]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => safeName(part));
    const name = `${parts.join('_')}.${extensionFor(scan.fileName, file.contentType)}`;

    return this.drive.upload(user.id, {
      folderPath: ['Receipts', project],
      name,
      mimeType: file.contentType,
      content: file.content,
      key: `invoice_scan:${scan.id}`,
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
