import { BadRequestException, Injectable } from '@nestjs/common';
import { gmail_v1, google } from 'googleapis';
import { createHash } from 'node:crypto';
import { GMAIL_READONLY_SCOPE } from '../google-calendar/google-scopes';
import { DriveFilesService } from './drive-files.service';
import { GoogleWorkspaceAuthService } from './google-workspace-auth.service';
import { MAX_ATTACHMENT_BYTES, safeName } from './workspace-input';

const INVOICE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export interface ImportInput {
  /** Exact Gmail label name. Only messages carrying it are ever read. */
  label: string;
  maxMessages: number;
  /** Only messages newer than this many days. */
  sinceDays?: number;
}

export interface ImportedFile {
  messageId: string;
  from: string;
  subject: string;
  fileName: string;
  driveName: string;
  driveId: string;
  url: string | null;
}

export interface ImportReport {
  label: string;
  messagesExamined: number;
  saved: ImportedFile[];
  /** Attachments already stored by a previous run (same email and attachment). */
  duplicates: number;
  skipped: Array<{ messageId: string; fileName: string; reason: string }>;
}

export interface AttachmentPart {
  partId: string;
  fileName: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

/** Walks the MIME tree and returns the real file attachments (not inline bodies). */
export function collectAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined): AttachmentPart[] {
  if (!part) return [];
  const own: AttachmentPart[] =
    part.filename && part.body?.attachmentId
      ? [
          {
            partId: part.partId ?? '',
            fileName: part.filename,
            mimeType: (part.mimeType ?? '').toLowerCase(),
            attachmentId: part.body.attachmentId,
            size: part.body.size ?? 0,
          },
        ]
      : [];
  return [...own, ...(part.parts ?? []).flatMap((child) => collectAttachmentParts(child))];
}

export function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? '';
}

/** Stable identity of one attachment of one email; stored on the Drive file to avoid duplicates. */
export function attachmentKey(messageId: string, partId: string): string {
  return `gmail:${createHash('sha1').update(`${messageId}:${partId}`).digest('hex').slice(0, 20)}`;
}

/**
 * Imports the invoice attachments of the emails that carry ONE label into
 * `Maros/Receipts/_Inbox` in Drive. Read-only on the mailbox: it never labels,
 * archives, deletes or sends. Each Drive file records the email it came from.
 */
@Injectable()
export class GmailInvoiceImportService {
  constructor(
    private readonly auth: GoogleWorkspaceAuthService,
    private readonly drive: DriveFilesService,
  ) {}

  async importLabel(userId: number, input: ImportInput): Promise<ImportReport> {
    const client = await this.auth.clientWithScope(userId, GMAIL_READONLY_SCOPE);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const labelId = await this.resolveLabel(gmail, input.label);
    const query = ['has:attachment', input.sinceDays ? `newer_than:${Math.floor(input.sinceDays)}d` : null]
      .filter(Boolean)
      .join(' ');
    const listed = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      q: query,
      maxResults: input.maxMessages,
    });

    const report: ImportReport = {
      label: input.label,
      messagesExamined: 0,
      saved: [],
      duplicates: 0,
      skipped: [],
    };

    for (const ref of listed.data.messages ?? []) {
      if (!ref.id) continue;
      report.messagesExamined += 1;
      const message = await gmail.users.messages.get({ userId: 'me', id: ref.id, format: 'full' });
      const headers = message.data.payload?.headers;
      const from = headerValue(headers, 'From');
      const subject = headerValue(headers, 'Subject');
      const received = message.data.internalDate
        ? new Date(Number(message.data.internalDate)).toISOString().slice(0, 10)
        : 'undated';

      const parts = collectAttachmentParts(message.data.payload);
      let handled = 0;
      for (const part of parts) {
        if (!INVOICE_TYPES.has(part.mimeType)) {
          report.skipped.push({ messageId: ref.id, fileName: part.fileName, reason: `tipo no admitido (${part.mimeType || 'desconocido'})` });
          continue;
        }
        if (part.size > MAX_ATTACHMENT_BYTES) {
          report.skipped.push({ messageId: ref.id, fileName: part.fileName, reason: 'supera 5 MB' });
          continue;
        }
        if (handled >= MAX_ATTACHMENTS_PER_MESSAGE) {
          report.skipped.push({ messageId: ref.id, fileName: part.fileName, reason: `más de ${MAX_ATTACHMENTS_PER_MESSAGE} adjuntos en el correo` });
          continue;
        }
        handled += 1;

        const body = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: ref.id,
          id: part.attachmentId,
        });
        const content = Buffer.from(body.data.data ?? '', 'base64url');
        if (content.length === 0) {
          report.skipped.push({ messageId: ref.id, fileName: part.fileName, reason: 'adjunto vacío' });
          continue;
        }

        const saved = await this.drive.upload(userId, {
          folderPath: ['Receipts', '_Inbox'],
          name: safeName(`${received}_${this.senderTag(from)}_${part.fileName}`),
          mimeType: part.mimeType,
          content,
          key: attachmentKey(ref.id, part.partId),
          avoidOverwrite: true,
          description: `Gmail ${ref.id} | De: ${from} | Asunto: ${subject} | Recibido: ${received}`,
        });
        if (saved.alreadyExisted) {
          report.duplicates += 1;
        } else {
          report.saved.push({
            messageId: ref.id,
            from,
            subject,
            fileName: part.fileName,
            driveName: saved.name,
            driveId: saved.id,
            url: saved.url,
          });
        }
      }
    }
    return report;
  }

  private senderTag(from: string): string {
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const domain = address.includes('@') ? address.split('@')[1] : address;
    return safeName(domain.split('.').slice(0, -1).join('-') || domain, 'sender');
  }

  private async resolveLabel(gmail: gmail_v1.Gmail, name: string): Promise<string> {
    const { data } = await gmail.users.labels.list({ userId: 'me' });
    const labels = data.labels ?? [];
    const found = labels.find((label) => label.name?.toLowerCase() === name.trim().toLowerCase());
    if (!found?.id) {
      const available = labels
        .filter((label) => label.type === 'user')
        .map((label) => label.name)
        .slice(0, 20)
        .join(', ');
      throw new BadRequestException(
        `No existe la etiqueta de Gmail "${name}". Etiquetas disponibles: ${available || '(ninguna)'}.`,
      );
    }
    return found.id;
  }
}
