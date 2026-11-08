import { BadRequestException, Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { GMAIL_LABELS_SCOPE } from '../google-calendar/google-scopes';
import { GoogleWorkspaceAuthService } from './google-workspace-auth.service';

export interface EnsuredLabel {
  id: string;
  name: string;
  /** False when a label with that name already existed and nothing was changed. */
  created: boolean;
}

const RESERVED = new Set([
  'inbox', 'sent', 'draft', 'drafts', 'trash', 'spam', 'starred', 'unread', 'important', 'chat', 'snoozed', 'scheduled',
]);

/** Names Gmail reserves for system labels, including the CATEGORY_* family. */
export function isReservedLabelName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return RESERVED.has(normalized) || normalized.startsWith('category_');
}

/**
 * Creates a Gmail label if it does not exist. It never renames, edits or deletes a
 * label and never touches messages: `gmail.labels` manages labels only.
 */
@Injectable()
export class GmailLabelsService {
  constructor(private readonly auth: GoogleWorkspaceAuthService) {}

  async ensureLabel(userId: number, name: string): Promise<EnsuredLabel> {
    const clean = name.trim();
    if (!clean || /[\r\n]/.test(clean)) throw new BadRequestException('El nombre de la etiqueta no es válido.');
    if (isReservedLabelName(clean)) {
      throw new BadRequestException(`"${clean}" es un nombre reservado de Gmail; elige otro.`);
    }

    const client = await this.auth.clientWithScope(userId, GMAIL_LABELS_SCOPE);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const { data } = await gmail.users.labels.list({ userId: 'me' });
    const existing = (data.labels ?? []).find((label) => label.name?.toLowerCase() === clean.toLowerCase());
    if (existing?.id) return { id: existing.id, name: existing.name ?? clean, created: false };

    const created = await gmail.users.labels.create({
      userId: 'me',
      requestBody: { name: clean, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
    if (!created.data.id) throw new Error('Gmail no devolvió el id de la etiqueta.');
    return { id: created.data.id, name: created.data.name ?? clean, created: true };
  }
}
