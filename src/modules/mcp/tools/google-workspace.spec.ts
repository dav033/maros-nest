import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerGoogleWorkspaceTools } from './google-workspace';

type Registered = { schema: ZodRawShape; handler: (args: Record<string, unknown>) => Promise<unknown> };

function setup() {
  const tools = new Map<string, Registered>();
  const server = {
    tool: (name: string, _d: string, schema: ZodRawShape, handler: Registered['handler']) => {
      tools.set(name, { schema, handler });
    },
  };
  const person = { id: 7, email: 'luis@maros.test', permissions: ['finance:write'] };
  const mcpActor = { userAs: jest.fn().mockResolvedValue(person) };
  const googleWorkspaceService = {
    createDraftWithAttachment: jest.fn().mockResolvedValue({ draftId: 'd' }),
    saveReportToDrive: jest.fn().mockResolvedValue({ id: 'f' }),
    saveInvoiceToReceipts: jest.fn().mockResolvedValue({ id: 'f' }),
    searchDriveFiles: jest.fn().mockResolvedValue({ visibility: 'all', files: [] }),
    importGmailInvoices: jest.fn().mockResolvedValue({ saved: [], duplicates: 0, skipped: [] }),
  };
  registerGoogleWorkspaceTools(server as unknown as McpServer, { mcpActor, googleWorkspaceService } as unknown as McpToolDeps);
  return { tools, mcpActor, googleWorkspaceService, person };
}

const parse = (schema: ZodRawShape, args: unknown) => z.object(schema).safeParse(args);
const ID = '8c81e542-2141-4ba4-b4f4-fb442eb2fafe';

describe('registerGoogleWorkspaceTools', () => {
  it('registers the five tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'create_draft_with_attachment',
      'import_gmail_invoices_to_receipts',
      'save_invoice_to_receipts',
      'save_report_to_drive',
      'search_drive_files',
    ]);
  });

  describe('create_draft_with_attachment', () => {
    const valid = { userId: 7, to: ['v@lion.com'], subject: 'Facturas', text: 'Hola', attachments: [{ kind: 'invoice_scan', id: ID }] };

    it('acts as the named person and forwards the draft', async () => {
      const { tools, mcpActor, googleWorkspaceService, person } = setup();
      const tool = tools.get('create_draft_with_attachment')!;

      expect(parse(tool.schema, valid).success).toBe(true);
      await tool.handler(valid);

      expect(mcpActor.userAs).toHaveBeenCalledWith(7);
      expect(googleWorkspaceService.createDraftWithAttachment).toHaveBeenCalledWith(
        person,
        expect.objectContaining({ to: ['v@lion.com'], subject: 'Facturas' }),
      );
    });

    it.each([
      ['no userId', { userId: undefined }],
      ['an invalid email', { to: ['no-es-un-correo'] }],
      ['no recipients', { to: [] }],
      ['more than 20 recipients', { to: Array.from({ length: 21 }, (_, i) => `a${i}@x.com`) }],
      ['a subject with a line break', { subject: 'Hola\r\nBcc: x@y.com' }],
      ['an attachment of a disallowed type', { attachments: [{ kind: 'inline', fileName: 'a.exe', contentType: 'application/x-msdownload', contentBase64: 'eA==' }] }],
      ['a non-uuid invoice scan', { attachments: [{ kind: 'invoice_scan', id: '../../etc/passwd' }] }],
      ['more than 10 attachments', { attachments: Array.from({ length: 11 }, () => ({ kind: 'invoice_scan', id: ID })) }],
    ])('rejects %s', (_label, override) => {
      const { tools } = setup();

      expect(parse(tools.get('create_draft_with_attachment')!.schema, { ...valid, ...override }).success).toBe(false);
    });

    it('accepts a Drive file attachment and rejects a malformed id', () => {
      const { tools } = setup();
      const schema = tools.get('create_draft_with_attachment')!.schema;
      const withFile = (fileId: string) => ({ ...valid, attachments: [{ kind: 'drive_file', fileId }] });

      expect(parse(schema, withFile('1AbCdEfGhIjKlMnOpQrStUvWxYz')).success).toBe(true);
      expect(parse(schema, withFile('short')).success).toBe(false);
      expect(parse(schema, withFile("abc'; drop table x;--")).success).toBe(false);
    });

    it('requires exactly one of text and html', async () => {
      const { tools, googleWorkspaceService } = setup();
      const tool = tools.get('create_draft_with_attachment')!;

      const both = (await tool.handler({ ...valid, html: '<p>x</p>' })) as { isError?: boolean };
      const none = (await tool.handler({ userId: 7, to: ['v@lion.com'], subject: 's' })) as { isError?: boolean };

      expect(both.isError).toBe(true);
      expect(none.isError).toBe(true);
      expect(googleWorkspaceService.createDraftWithAttachment).not.toHaveBeenCalled();
    });
  });

  describe('save_report_to_drive', () => {
    it('forwards the report as the named person', async () => {
      const { tools, googleWorkspaceService, person } = setup();
      const args = { userId: 7, name: 'cobros.md', contentType: 'text/markdown', text: '# x', folder: ['064P-0826'], key: 'k' };

      expect(parse(tools.get('save_report_to_drive')!.schema, args).success).toBe(true);
      await tools.get('save_report_to_drive')!.handler(args);

      expect(googleWorkspaceService.saveReportToDrive).toHaveBeenCalledWith(person, expect.objectContaining({ name: 'cobros.md' }));
    });

    it('accepts addDate with an ISO date and rejects other formats', () => {
      const { tools } = setup();
      const schema = tools.get('save_report_to_drive')!.schema;
      const base = { userId: 7, name: 'r.pdf', contentType: 'application/pdf', contentBase64: 'JVBERg==' };

      expect(parse(schema, { ...base, addDate: true, date: '2026-11-08' }).success).toBe(true);
      expect(parse(schema, { ...base, addDate: true, date: '11/08/2026' }).success).toBe(false);
    });

    it.each([
      ['a disallowed content type', { contentType: 'application/zip' }],
      ['a blank name', { name: '  ' }],
      ['a name with a line break', { name: 'a\nb' }],
      ['too many sub-folders', { folder: ['a', 'b', 'c', 'd'] }],
      ['a blank sub-folder', { folder: [' '] }],
    ])('rejects %s', (_label, override) => {
      const { tools } = setup();
      const base = { userId: 7, name: 'r.md', contentType: 'text/markdown', text: 'x' };

      expect(parse(tools.get('save_report_to_drive')!.schema, { ...base, ...override }).success).toBe(false);
    });
  });

  describe('save_invoice_to_receipts', () => {
    it('forwards the scan id and optional project', async () => {
      const { tools, googleWorkspaceService, person } = setup();
      const args = { userId: 7, invoiceScanId: ID, project: '064P-0826' };

      expect(parse(tools.get('save_invoice_to_receipts')!.schema, args).success).toBe(true);
      await tools.get('save_invoice_to_receipts')!.handler(args);

      expect(googleWorkspaceService.saveInvoiceToReceipts).toHaveBeenCalledWith(person, { invoiceScanId: ID, project: '064P-0826' });
    });

    it('forwards vendor and amount overrides and rejects nonsense values', async () => {
      const { tools, googleWorkspaceService, person } = setup();
      const schema = tools.get('save_invoice_to_receipts')!.schema;
      const args = { userId: 7, invoiceScanId: ID, vendor: 'Home Depot', amount: 1250 };

      expect(parse(schema, args).success).toBe(true);
      await tools.get('save_invoice_to_receipts')!.handler(args);
      expect(googleWorkspaceService.saveInvoiceToReceipts).toHaveBeenCalledWith(person, { invoiceScanId: ID, vendor: 'Home Depot', amount: 1250 });

      expect(parse(schema, { ...args, amount: -5 }).success).toBe(false);
      expect(parse(schema, { ...args, amount: Number.NaN }).success).toBe(false);
      expect(parse(schema, { ...args, vendor: 'a\nb' }).success).toBe(false);
    });

    it.each([
      ['a non-uuid id', { invoiceScanId: 'abc' }],
      ['a project with a slash', { project: '064P/../x' }],
    ])('rejects %s', (_label, override) => {
      const { tools } = setup();

      expect(parse(tools.get('save_invoice_to_receipts')!.schema, { userId: 7, invoiceScanId: ID, ...override }).success).toBe(false);
    });

    it('does not call the service when the acting account is refused', async () => {
      const { tools, mcpActor, googleWorkspaceService } = setup();
      mcpActor.userAs.mockRejectedValue(new Error('La cuenta está desactivada'));

      const result = (await tools.get('save_invoice_to_receipts')!.handler({ userId: 7, invoiceScanId: ID })) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(googleWorkspaceService.saveInvoiceToReceipts).not.toHaveBeenCalled();
    });
  });

  describe('search_drive_files', () => {
    it('acts as the named person, applies the default limit and forwards filters', async () => {
      const { tools, googleWorkspaceService, person } = setup();
      const tool = tools.get('search_drive_files')!;
      const args = { userId: 7, nameContains: 'waiver', mimeType: 'application/pdf', modifiedAfter: '2026-11-01' };

      expect(parse(tool.schema, args).success).toBe(true);
      await tool.handler(args);

      expect(googleWorkspaceService.searchDriveFiles).toHaveBeenCalledWith(person, { nameContains: 'waiver', mimeType: 'application/pdf', modifiedAfter: '2026-11-01', limit: 20 });
    });

    it.each([
      ['a blank search text', { nameContains: ' ' }],
      ['a bad mime type', { mimeType: "application/pdf' or '1'='1" }],
      ['a malformed folder id', { folderId: "x' in parents or 'a" }],
      ['a bad date', { modifiedAfter: 'yesterday' }],
      ['a limit over 50', { limit: 500 }],
    ])('rejects %s', (_label, override) => {
      const { tools } = setup();

      expect(parse(tools.get('search_drive_files')!.schema, { userId: 7, ...override }).success).toBe(false);
    });
  });

  describe('import_gmail_invoices_to_receipts', () => {
    it('forwards the label with a default of 10 messages', async () => {
      const { tools, googleWorkspaceService, person } = setup();
      const tool = tools.get('import_gmail_invoices_to_receipts')!;

      expect(parse(tool.schema, { userId: 7, label: 'Invoices', sinceDays: 30 }).success).toBe(true);
      await tool.handler({ userId: 7, label: 'Invoices', sinceDays: 30 });

      expect(googleWorkspaceService.importGmailInvoices).toHaveBeenCalledWith(person, { label: 'Invoices', sinceDays: 30, maxMessages: 10 });
    });

    it.each([
      ['no label', { label: undefined }],
      ['a blank label', { label: '  ' }],
      ['a label with a line break', { label: 'a\nb' }],
      ['more than 25 messages', { maxMessages: 26 }],
      ['zero messages', { maxMessages: 0 }],
      ['more than a year', { sinceDays: 400 }],
    ])('rejects %s', (_label, override) => {
      const { tools } = setup();

      expect(parse(tools.get('import_gmail_invoices_to_receipts')!.schema, { userId: 7, label: 'Invoices', ...override }).success).toBe(false);
    });
  });
});
