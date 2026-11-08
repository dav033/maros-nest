import { BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import {
  attachmentKey,
  collectAttachmentParts,
  GmailInvoiceImportService,
  headerValue,
} from './gmail-invoice-import.service';

jest.mock('googleapis', () => ({ google: { gmail: jest.fn() } }));

const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';

describe('collectAttachmentParts', () => {
  it('finds real attachments at any depth and ignores inline bodies', () => {
    const parts = collectAttachmentParts({
      mimeType: 'multipart/mixed',
      parts: [
        { partId: '0', mimeType: 'text/plain', filename: '', body: { size: 10 } },
        {
          partId: '1',
          mimeType: 'multipart/related',
          parts: [{ partId: '1.1', mimeType: 'application/pdf', filename: 'inv.pdf', body: { attachmentId: 'att-1', size: 1200 } }],
        },
        { partId: '2', mimeType: 'IMAGE/PNG', filename: 'scan.png', body: { attachmentId: 'att-2', size: 300 } },
      ],
    });

    expect(parts).toEqual([
      { partId: '1.1', fileName: 'inv.pdf', mimeType: 'application/pdf', attachmentId: 'att-1', size: 1200 },
      { partId: '2', fileName: 'scan.png', mimeType: 'image/png', attachmentId: 'att-2', size: 300 },
    ]);
    expect(collectAttachmentParts(undefined)).toEqual([]);
  });
});

describe('headerValue / attachmentKey', () => {
  it('reads headers case-insensitively', () => {
    expect(headerValue([{ name: 'SUBJECT', value: ' Hola ' }], 'subject')).toBe('Hola');
    expect(headerValue(undefined, 'From')).toBe('');
  });

  it('is stable per email and attachment, and different across them', () => {
    expect(attachmentKey('m1', '1.1')).toBe(attachmentKey('m1', '1.1'));
    expect(attachmentKey('m1', '1.1')).not.toBe(attachmentKey('m1', '1.2'));
    expect(attachmentKey('m1', '1.1')).not.toBe(attachmentKey('m2', '1.1'));
    expect(attachmentKey('m1', '1.1')).toMatch(/^gmail:[0-9a-f]{20}$/);
  });
});

describe('GmailInvoiceImportService.importLabel', () => {
  const auth = { clientWithScope: jest.fn().mockResolvedValue({}) };

  const pdfBase64Url = Buffer.from('%PDF-1.4 fake').toString('base64url');

  function setup(opts: { labels?: Array<{ id: string; name: string; type?: string }>; messages?: Record<string, unknown>; alreadyExisted?: boolean } = {}) {
    const labels = opts.labels ?? [{ id: 'L1', name: 'Invoices', type: 'user' }];
    const messages = opts.messages ?? {
      m1: {
        id: 'm1',
        internalDate: String(Date.UTC(2026, 10, 3)),
        payload: {
          headers: [
            { name: 'From', value: 'Lion Billing <billing@lion-supply.com>' },
            { name: 'Subject', value: 'Invoice 8841' },
          ],
          parts: [
            { partId: '1', mimeType: 'application/pdf', filename: 'INV-8841.pdf', body: { attachmentId: 'a1', size: 2000 } },
            { partId: '2', mimeType: 'application/zip', filename: 'extra.zip', body: { attachmentId: 'a2', size: 2000 } },
            { partId: '3', mimeType: 'application/pdf', filename: 'huge.pdf', body: { attachmentId: 'a3', size: 6 * 1024 * 1024 } },
          ],
        },
      },
    };
    const list = jest.fn().mockResolvedValue({ data: { messages: Object.keys(messages).map((id) => ({ id })) } });
    const get = jest.fn(({ id }: { id: string }) => Promise.resolve({ data: (messages)[id] }));
    const attachmentsGet = jest.fn().mockResolvedValue({ data: { data: pdfBase64Url } });
    const labelsList = jest.fn().mockResolvedValue({ data: { labels } });
    // Anything that could change the mailbox must never be called.
    const forbidden = { modify: jest.fn(), send: jest.fn(), trash: jest.fn(), delete: jest.fn(), batchModify: jest.fn() };
    (google.gmail as jest.Mock).mockReturnValue({
      users: { labels: { list: labelsList }, messages: { list, get, attachments: { get: attachmentsGet }, ...forbidden } },
    });
    const upload = jest.fn().mockResolvedValue({ id: 'drive-1', name: 'saved.pdf', url: 'https://drive/1', alreadyExisted: opts.alreadyExisted ?? false });
    const service = new GmailInvoiceImportService(auth as never, { upload } as never);
    return { service, list, get, attachmentsGet, upload, forbidden };
  }

  beforeEach(() => jest.clearAllMocks());

  it('saves the invoice attachment with its origin and skips what is not an invoice', async () => {
    const { service, upload, list } = setup();

    const report = await service.importLabel(7, { label: 'invoices', maxMessages: 10, sinceDays: 30 });

    expect(auth.clientWithScope).toHaveBeenCalledWith(7, READONLY);
    expect(list.mock.calls[0][0]).toMatchObject({ labelIds: ['L1'], q: 'has:attachment newer_than:30d', maxResults: 10 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toMatchObject({
      folderPath: ['Receipts', '_Inbox'],
      name: '2026-11-03_lion-supply_INV-8841.pdf',
      mimeType: 'application/pdf',
      avoidOverwrite: true,
      key: attachmentKey('m1', '1'),
      description: expect.stringContaining('Gmail m1 | De: Lion Billing <billing@lion-supply.com> | Asunto: Invoice 8841'),
    });
    expect(report.messagesExamined).toBe(1);
    expect(report.saved).toEqual([
      { messageId: 'm1', from: 'Lion Billing <billing@lion-supply.com>', subject: 'Invoice 8841', fileName: 'INV-8841.pdf', driveName: 'saved.pdf', driveId: 'drive-1', url: 'https://drive/1' },
    ]);
    expect(report.skipped.map((item) => item.reason)).toEqual([expect.stringContaining('tipo no admitido'), 'supera 5 MB']);
  });

  it('counts an attachment stored by a previous run as a duplicate, not as new', async () => {
    const { service } = setup({ alreadyExisted: true });

    const report = await service.importLabel(7, { label: 'Invoices', maxMessages: 10 });

    expect(report.saved).toEqual([]);
    expect(report.duplicates).toBe(1);
  });

  it('refuses an unknown label and lists the user labels, without reading any message', async () => {
    const { service, list } = setup({ labels: [{ id: 'L1', name: 'Invoices', type: 'user' }, { id: 'INBOX', name: 'INBOX', type: 'system' }] });

    await expect(service.importLabel(7, { label: 'Secrets', maxMessages: 5 })).rejects.toThrow(/No existe la etiqueta.*Invoices/);
    await expect(service.importLabel(7, { label: 'Secrets', maxMessages: 5 })).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it('never modifies, labels, trashes, deletes or sends anything in the mailbox', async () => {
    const { service, forbidden } = setup();

    await service.importLabel(7, { label: 'Invoices', maxMessages: 10 });

    for (const call of Object.values(forbidden)) expect(call).not.toHaveBeenCalled();
  });

  it('skips an empty attachment instead of storing an empty file', async () => {
    const { service, attachmentsGet, upload } = setup();
    attachmentsGet.mockResolvedValue({ data: { data: '' } });

    const report = await service.importLabel(7, { label: 'Invoices', maxMessages: 10 });

    expect(upload).not.toHaveBeenCalled();
    expect(report.skipped.some((item) => item.reason === 'adjunto vacío')).toBe(true);
  });
});
