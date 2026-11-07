import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer';
import { GMAIL_COMPOSE_SCOPE } from '../google-calendar/google-scopes';
import { GoogleWorkspaceAuthService } from './google-workspace-auth.service';
import { hasLineBreak } from './workspace-input';

export interface DraftAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface DraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain text body. Exactly one of `text` and `html` must be present. */
  text?: string;
  html?: string;
  attachments: DraftAttachment[];
}

export interface DraftResult {
  draftId: string;
  messageId: string | null;
  threadId: string | null;
  url: string;
  attachments: Array<{ fileName: string; bytes: number }>;
}

/**
 * Creates drafts in the person's Gmail. It never sends: there is no send call in
 * this class, and the person reviews and sends from Gmail themselves.
 */
@Injectable()
export class GmailDraftsService {
  constructor(private readonly auth: GoogleWorkspaceAuthService) {}

  async createDraft(userId: number, input: DraftInput): Promise<DraftResult> {
    this.assertSafe(input);
    const client = await this.auth.clientWithScope(userId, GMAIL_COMPOSE_SCOPE);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const raw = await this.buildRaw(input);
    const { data } = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });
    if (!data.id) throw new Error('Gmail no devolvió el id del borrador.');

    return {
      draftId: data.id,
      messageId: data.message?.id ?? null,
      threadId: data.message?.threadId ?? null,
      url: 'https://mail.google.com/mail/u/0/#drafts',
      attachments: input.attachments.map((file) => ({
        fileName: file.fileName,
        bytes: file.content.length,
      })),
    };
  }

  private assertSafe(input: DraftInput): void {
    if (hasLineBreak(input.subject)) throw new Error('El asunto no puede tener saltos de línea.');
    const hasText = typeof input.text === 'string' && input.text.length > 0;
    const hasHtml = typeof input.html === 'string' && input.html.length > 0;
    if (hasText === hasHtml) throw new Error('Indica el cuerpo como text o como html, no ambos ni ninguno.');
    if (input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0) === 0) {
      throw new Error('El borrador necesita al menos un destinatario.');
    }
  }

  private buildRaw(input: DraftInput): Promise<string> {
    const composer = new MailComposer({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments.map((file) => ({
        filename: file.fileName,
        contentType: file.contentType,
        content: file.content,
      })),
    });
    return new Promise((resolve, reject) => {
      composer.compile().build((error, message) => {
        if (error) return reject(error);
        resolve(message.toString('base64url'));
      });
    });
  }
}
