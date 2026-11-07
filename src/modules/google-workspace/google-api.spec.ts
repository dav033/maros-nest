import { google } from 'googleapis';
import { DriveFilesService } from './drive-files.service';
import { GmailDraftsService } from './gmail-drafts.service';

jest.mock('googleapis', () => ({ google: { gmail: jest.fn(), drive: jest.fn() } }));

const auth = { clientWithScope: jest.fn().mockResolvedValue({}) };

beforeEach(() => {
  jest.clearAllMocks();
  auth.clientWithScope.mockResolvedValue({});
});

describe('GmailDraftsService', () => {
  function mockGmail() {
    const create = jest.fn().mockResolvedValue({ data: { id: 'draft-1', message: { id: 'm1', threadId: 't1' } } });
    (google.gmail as jest.Mock).mockReturnValue({ users: { drafts: { create }, messages: { send: jest.fn() } } });
    return create;
  }

  const base = {
    to: ['proveedor@lion.com'],
    subject: 'Factura 064P',
    text: 'Adjunto la factura.',
    attachments: [{ fileName: 'inv.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 fake') }],
  };

  it('creates a draft whose MIME carries recipients, subject, body and the attachment', async () => {
    const create = mockGmail();

    const result = await new GmailDraftsService(auth as never).createDraft(7, base);

    expect(auth.clientWithScope).toHaveBeenCalledWith(7, 'https://www.googleapis.com/auth/gmail.compose');
    const raw = create.mock.calls[0][0].requestBody.message.raw as string;
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: proveedor@lion.com');
    expect(mime).toContain('Subject: Factura 064P');
    expect(mime).toContain('Adjunto la factura.');
    expect(mime).toMatch(/Content-Disposition: attachment;\s+filename=.?inv\.pdf/);
    expect(result).toMatchObject({ draftId: 'draft-1', attachments: [{ fileName: 'inv.pdf', bytes: 13 }] });
  });

  it('never calls send', async () => {
    mockGmail();
    const gmail = (google.gmail as jest.Mock)();

    await new GmailDraftsService(auth as never).createDraft(7, base);

    expect(gmail.users.messages.send).not.toHaveBeenCalled();
  });

  it.each([
    ['a subject with a line break', { subject: 'Hola\r\nBcc: x@y.com' }],
    ['both text and html', { html: '<p>x</p>' }],
    ['no body', { text: undefined }],
    ['no recipients', { to: [] }],
  ])('rejects %s before contacting Google', async (_label, override) => {
    const create = mockGmail();

    await expect(new GmailDraftsService(auth as never).createDraft(7, { ...base, ...override })).rejects.toThrow();
    expect(auth.clientWithScope).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('DriveFilesService', () => {
  function mockDrive(opts: { existingFolders?: Record<string, string>; existingFile?: boolean } = {}) {
    const calls = { list: [] as string[], created: [] as Array<Record<string, unknown>> };
    const list = jest.fn(({ q }: { q: string }) => {
      calls.list.push(q);
      if (q.includes("appProperties has")) {
        return Promise.resolve({ data: { files: opts.existingFile ? [{ id: 'old', name: 'x.pdf', webViewLink: 'https://drive/old' }] : [] } });
      }
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1] ?? '';
      const id = opts.existingFolders?.[name];
      return Promise.resolve({ data: { files: id ? [{ id }] : [] } });
    });
    let n = 0;
    const create = jest.fn((args: { requestBody: Record<string, unknown> }) => {
      calls.created.push(args.requestBody);
      n += 1;
      return Promise.resolve({ data: { id: `new-${n}`, name: args.requestBody.name, webViewLink: `https://drive/new-${n}` } });
    });
    (google.drive as jest.Mock).mockReturnValue({ files: { list, create } });
    return { calls, create };
  }

  const input = { folderPath: ['Receipts', '064P-0826'], name: 'inv.pdf', mimeType: 'application/pdf', content: Buffer.from('x') };

  it('creates the missing folders under Maros and uploads inside the last one', async () => {
    const { calls } = mockDrive();

    const result = await new DriveFilesService(auth as never).upload(7, input);

    expect(auth.clientWithScope).toHaveBeenCalledWith(7, 'https://www.googleapis.com/auth/drive.file');
    expect(calls.created.map((c) => c.name)).toEqual(['Maros', 'Receipts', '064P-0826', 'inv.pdf']);
    expect(calls.created[3].parents).toEqual(['new-3']);
    expect(result).toMatchObject({ id: 'new-4', folder: 'Maros/Receipts/064P-0826', alreadyExisted: false });
  });

  it('reuses folders that already exist', async () => {
    const { calls } = mockDrive({ existingFolders: { Maros: 'f-maros', Receipts: 'f-rec', '064P-0826': 'f-proj' } });

    await new DriveFilesService(auth as never).upload(7, input);

    expect(calls.created.map((c) => c.name)).toEqual(['inv.pdf']);
    expect(calls.created[0].parents).toEqual(['f-proj']);
  });

  it('returns the existing file when the key is already stored, without uploading again', async () => {
    const { create } = mockDrive({
      existingFolders: { Maros: 'f-maros', Receipts: 'f-rec', '064P-0826': 'f-proj' },
      existingFile: true,
    });

    const result = await new DriveFilesService(auth as never).upload(7, { ...input, key: 'invoice_scan:abc' });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'old', alreadyExisted: true });
  });

  it('escapes names so they cannot alter the Drive query', async () => {
    const { calls } = mockDrive();

    await new DriveFilesService(auth as never).upload(7, { ...input, folderPath: ["x' or trashed = true or name = '"] });

    expect(calls.list.some((q) => q.includes("x\\' or trashed = true or name = \\'"))).toBe(true);
    expect(calls.list.every((q) => !q.includes("name = 'x' or"))).toBe(true);
  });

  it('refuses folder paths that are too deep', async () => {
    mockDrive();

    await expect(
      new DriveFilesService(auth as never).upload(7, { ...input, folderPath: ['a', 'b', 'c', 'd', 'e'] }),
    ).rejects.toThrow(/niveles/);
    expect(auth.clientWithScope).not.toHaveBeenCalled();
  });
});
