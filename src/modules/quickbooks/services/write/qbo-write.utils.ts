import type { InvoiceScan } from '../../entities/invoice-scan.entity';

/**
 * Pure helpers for the basic QuickBooks writes. Kept free of I/O so every rule
 * (what may be attached, how a note is merged, when a bill is NOT ready) is
 * testable without QuickBooks.
 */

/** Transactions a file may be attached to. Attaching only adds a document. */
export const ATTACHABLE_ENTITY_TYPES = ['Bill', 'Purchase', 'Invoice', 'Estimate', 'VendorCredit', 'Deposit'] as const;
/** Transactions whose private note may be edited (a memo; amounts and accounts are never touched). */
export const NOTE_ENTITY_TYPES = ['Bill', 'Purchase', 'Invoice', 'Estimate'] as const;
export type AttachableEntityType = (typeof ATTACHABLE_ENTITY_TYPES)[number];
export type NoteEntityType = (typeof NOTE_ENTITY_TYPES)[number];

export const QBO_ID = /^\d{1,20}$/;
export const ATTACHABLE_CONTENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const MAX_QBO_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PRIVATE_NOTE = 4000;

/** A file name that is safe inside a multipart header. */
export function safeUploadName(name: string): string {
  let spaced = '';
  for (const char of name) {
    const code = char.charCodeAt(0);
    spaced += code < 0x20 || code === 0x7f || char === '"' || char === '\\' || char === '/' ? ' ' : char;
  }
  const cleaned = spaced.replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned || 'attachment';
}

/** multipart/form-data body for QuickBooks' `/upload`: one metadata part and one file part. */
export function buildAttachableMultipart(input: {
  boundary: string;
  fileName: string;
  contentType: string;
  content: Buffer;
  refs: Array<{ type: string; id: string }>;
}): Buffer {
  const fileName = safeUploadName(input.fileName);
  const metadata = JSON.stringify({
    AttachableRef: input.refs.map((ref) => ({ EntityRef: { type: ref.type, value: ref.id } })),
    FileName: fileName,
    ContentType: input.contentType,
  });
  const head =
    `--${input.boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"\r\n` +
    `Content-Type: application/json\r\n\r\n${metadata}\r\n` +
    `--${input.boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${fileName}"\r\n` +
    `Content-Type: ${input.contentType}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head), input.content, Buffer.from(`\r\n--${input.boundary}--\r\n`)]);
}

/** Appends a line to the existing note (default) or replaces it; the result never exceeds the QBO limit. */
export function mergeNote(existing: string | null | undefined, note: string, mode: 'append' | 'replace'): string {
  const clean = note.trim();
  const base = (existing ?? '').trim();
  const merged = mode === 'replace' || base.length === 0 ? clean : `${base}\n${clean}`;
  return merged.slice(0, MAX_PRIVATE_NOTE);
}

export interface BillPreview {
  ready: boolean;
  /** Why the bill must NOT be created yet; empty when ready. */
  blockers: string[];
  /** Exactly what would be sent to QuickBooks (never sent by the preview). */
  payload: Record<string, unknown> | null;
}

/**
 * What a Bill built from an invoice scan would look like, and what stops it. It
 * is deliberately conservative: nothing is defaulted, a missing vendor match,
 * expense account, date or total is reported as a blocker.
 */
export function buildBillPreview(scan: InvoiceScan, options: { accountId?: string } = {}): BillPreview {
  const data = scan.extractedData;
  const blockers: string[] = [];

  if (!data) blockers.push('The scan has no extracted data yet.');
  if (scan.enteredAt) blockers.push('The scan is already marked as entered in QuickBooks.');
  if (data && data.direction !== 'incoming') blockers.push('Only incoming invoices (money Maros owes) become bills.');
  if (data && (data.counterpartyType !== 'Vendor' || !data.counterpartyId)) {
    blockers.push('The vendor is not matched to a QuickBooks vendor yet.');
  }
  if (data && (data.total === null || data.total === undefined || data.total <= 0)) blockers.push('The invoice has no positive total.');
  if (data && !data.issueDate) blockers.push('The invoice has no issue date.');
  if (!options.accountId) blockers.push('Pick the expense account (accountId): it is never guessed.');
  if (options.accountId && !QBO_ID.test(options.accountId)) blockers.push('accountId is not a valid QuickBooks id.');

  if (blockers.length > 0 || !data) return { ready: false, blockers, payload: null };

  const description = [`Invoice ${data.invoiceNumber ?? ''}`.trim(), data.counterpartyName].filter(Boolean).join(' - ');
  return {
    ready: true,
    blockers: [],
    payload: {
      VendorRef: { value: data.counterpartyId },
      TxnDate: data.issueDate,
      ...(data.dueDate ? { DueDate: data.dueDate } : {}),
      ...(data.invoiceNumber ? { DocNumber: data.invoiceNumber } : {}),
      PrivateNote: `Maros invoice scan ${scan.id}`,
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: Math.round((data.total as number) * 100) / 100,
          Description: description,
          AccountBasedExpenseLineDetail: { AccountRef: { value: options.accountId } },
        },
      ],
    },
  };
}
