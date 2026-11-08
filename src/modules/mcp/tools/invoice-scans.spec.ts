import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerInvoiceScanTools } from './invoice-scans';

/**
 * El MCP llama al servicio sin pasar por el ValidationPipe de Nest, así que los
 * esquemas zod de estas tools son la única validación que corre. Lo que se prueba
 * acá es justamente eso: que un argumento inválido no llegue nunca al servicio.
 */

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function registerTools() {
  const tools = new Map<string, Registered>();
  const server = {
    tool: (
      name: string,
      description: string,
      schema: ZodRawShape,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      tools.set(name, { description, schema, handler });
    },
  };

  const invoiceScansService = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 'x' }),
    getDownloadUrl: jest.fn().mockResolvedValue({ url: 'u', fileName: 'f.pdf' }),
    createManualTransaction: jest.fn().mockResolvedValue({ id: 'new' }),
    update: jest.fn().mockResolvedValue({ id: 'x' }),
    prepareFileAttachment: jest.fn().mockResolvedValue({ id: 'x', key: 'k', uploadUrl: 'u' }),
    completeFileAttachment: jest.fn().mockResolvedValue({ id: 'x', hasFile: true }),
    scan: jest.fn().mockResolvedValue({ id: 'x' }),
    remove: jest.fn().mockResolvedValue({ id: 'x', deleted: true }),
  };

  const invoiceSearchService = {
    search: jest.fn().mockResolvedValue({ results: [], missing: [] }),
  };

  const invoiceLocationService = {
    history: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ location: { id: 'l1' }, changed: true }),
  };

  registerInvoiceScanTools(server as unknown as McpServer, {
    invoiceScansService,
    invoiceSearchService,
    invoiceLocationService,
  } as unknown as McpToolDeps);

  return { tools, invoiceScansService, invoiceSearchService, invoiceLocationService };
}

const ID = '8c81e542-2141-4ba4-b4f4-fb442eb2fafe';

/** Corre el esquema de la tool como lo haría el SDK antes de llamar al handler. */
function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

describe('registerInvoiceScanTools', () => {
  it('registers the document-scan tools, including both attachment phases', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'attach_invoice_scan_file',
      'complete_invoice_scan_file_attachment',
      'create_manual_transaction',
      'delete_invoice_scan',
      'get_invoice_locations',
      'get_invoice_scan',
      'get_invoice_scan_download_url',
      'list_invoice_scans',
      'rescan_invoice_scan',
      'search_invoices',
      'update_invoice_location',
      'update_invoice_scan',
    ]);
  });

  describe('invoice index tools', () => {
    it('get_invoice_locations reads the history of a scan', async () => {
      const { tools, invoiceLocationService } = registerTools();

      await tools.get('get_invoice_locations')!.handler({ id: ID });

      expect(invoiceLocationService.history).toHaveBeenCalledWith(ID);
    });

    it('update_invoice_location forwards the change attributed to the MCP', async () => {
      const { tools, invoiceLocationService } = registerTools();
      const args = { id: ID, status: 'categorized', driveFolder: 'Maros/Receipts/Categorized/064P', note: 'Alexandra categorised it' };

      expect(parse(tools.get('update_invoice_location')!.schema, args).success).toBe(true);
      await tools.get('update_invoice_location')!.handler(args);

      expect(invoiceLocationService.update).toHaveBeenCalledWith({
        invoiceScanId: ID,
        status: 'categorized',
        driveFileId: undefined,
        driveFolder: 'Maros/Receipts/Categorized/064P',
        note: 'Alexandra categorised it',
        actor: 'mcp',
      });
    });

    it.each([
      ['an unknown status', { status: 'deleted' }],
      ['a non-uuid id', { id: 'abc' }],
      ['a malformed drive file id', { driveFileId: "x' or 1=1" }],
      ['a folder with a line break', { driveFolder: 'a\nb' }],
      ['an empty note', { note: ' ' }],
    ])('update_invoice_location rejects %s', (_label, override) => {
      const { tools } = registerTools();

      expect(parse(tools.get('update_invoice_location')!.schema, { id: ID, status: 'moved', ...override }).success).toBe(false);
    });
  });

  describe('search_invoices', () => {
    it('forwards projects, vendors and dates to the search service', async () => {
      const { tools, invoiceSearchService } = registerTools();
      const tool = tools.get('search_invoices')!;
      const args = {
        projects: ['064P'],
        vendors: ['Lion', 'Bond', 'Home Depot'],
        date_from: '2026-09-01',
        date_to: '2026-09-30',
      };

      expect(parse(tool.schema, args).success).toBe(true);
      await tool.handler(args);

      expect(invoiceSearchService.search).toHaveBeenCalledWith({
        projects: ['064P'],
        vendors: ['Lion', 'Bond', 'Home Depot'],
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
      });
    });

    it('treats vendors and dates as optional', async () => {
      const { tools, invoiceSearchService } = registerTools();
      const tool = tools.get('search_invoices')!;

      await tool.handler({ projects: ['064P-0826'] });

      expect(invoiceSearchService.search).toHaveBeenCalledWith({
        projects: ['064P-0826'],
        vendors: [],
        dateFrom: undefined,
        dateTo: undefined,
      });
    });

    it.each([
      ['no projects', { projects: [] }],
      ['a wildcard in the project', { projects: ['064%'] }],
      ['an injection attempt', { projects: ["064P' OR 1=1 --"] }],
      ['too many projects', { projects: Array.from({ length: 21 }, (_, i) => `0${i}P`) }],
      ['a blank vendor', { projects: ['064P'], vendors: [' '] }],
      ['a bad date', { projects: ['064P'], date_from: '09/01/2026' }],
    ])('rejects %s before touching the service', (_label, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get('search_invoices')!.schema, args).success).toBe(false);
    });

    it('refuses a date range that is backwards', async () => {
      const { tools, invoiceSearchService } = registerTools();
      const tool = tools.get('search_invoices')!;

      const result = (await tool.handler({
        projects: ['064P'],
        date_from: '2026-10-01',
        date_to: '2026-09-01',
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/date_from/);
      expect(invoiceSearchService.search).not.toHaveBeenCalled();
    });
  });

  describe('create_manual_transaction', () => {
    it('forwards the arguments without an actor, so the edit has no author', async () => {
      const { tools, invoiceScansService } = registerTools();
      const args = {
        description: 'Deposit for the Smith roof',
        direction: 'payment_received',
        transactionDate: '2026-09-30',
        amount: 1500,
      };

      await tools.get('create_manual_transaction')!.handler(args);

      expect(invoiceScansService.createManualTransaction).toHaveBeenCalledWith(args);
      expect(invoiceScansService.createManualTransaction).toHaveBeenCalledTimes(1);
      // Un segundo argumento aquí sería un actor inventado.
      expect(invoiceScansService.createManualTransaction.mock.calls[0]).toHaveLength(1);
    });

    it.each([
      ['an amount of zero', { amount: 0 }],
      ['a date that is not ISO', { transactionDate: '30/09/2026' }],
      ['an empty description', { description: '   ' }],
      ['a direction that does not exist', { direction: 'refund' }],
      ['a currency that is not three letters', { currency: 'dollars' }],
    ])('rejects %s', (_label, override) => {
      const { tools } = registerTools();
      const args = {
        description: 'Deposit',
        direction: 'payment_received',
        transactionDate: '2026-09-30',
        amount: 1500,
        ...override,
      };

      expect(parse(tools.get('create_manual_transaction')!.schema, args).success).toBe(
        false,
      );
    });
  });

  describe('update_invoice_scan', () => {
    it('sends every field except the id as the patch', async () => {
      const { tools, invoiceScansService } = registerTools();

      await tools.get('update_invoice_scan')!.handler({
        id: ID,
        total: 240,
        comments: 'Checked against the estimate',
        entered: true,
      });

      expect(invoiceScansService.update).toHaveBeenCalledWith(ID, {
        total: 240,
        comments: 'Checked against the estimate',
        entered: true,
      });
    });

    it('accepts null to clear a field', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('update_invoice_scan')!.schema, {
          id: ID,
          projectNumber: null,
          counterpartyName: null,
        }).success,
      ).toBe(true);
    });

    it('rejects an id that is not a uuid', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('update_invoice_scan')!.schema, { id: 'not-a-uuid' }).success,
      ).toBe(false);
    });
  });

  describe('delete_invoice_scan', () => {
    it('deletes when the call confirms it', async () => {
      const { tools, invoiceScansService } = registerTools();

      await tools.get('delete_invoice_scan')!.handler({ id: ID, confirm: true });

      expect(invoiceScansService.remove).toHaveBeenCalledWith(ID);
    });

    // Borrar es irreversible y el registro es financiero: el flag existe para que
    // una llamada mal interpretada no alcance para destruirlo.
    it.each([
      ['confirm is false', { id: ID, confirm: false }],
      ['confirm is missing', { id: ID }],
    ])('refuses when %s', (_label, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get('delete_invoice_scan')!.schema, args).success).toBe(false);
    });
  });

  describe('attach_invoice_scan_file', () => {
    const file = {
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    };

    it('separates the id from the file description', async () => {
      const { tools, invoiceScansService } = registerTools();

      await tools.get('attach_invoice_scan_file')!.handler({ id: ID, ...file });

      expect(invoiceScansService.prepareFileAttachment).toHaveBeenCalledWith(ID, file);
    });

    it('validates and forwards the finalization metadata', async () => {
      const { tools, invoiceScansService } = registerTools();
      const args = {
        id: ID,
        key: 'mcp/attachments/invoice-scans/scan/receipt.pdf',
        ...file,
      };

      await tools.get('complete_invoice_scan_file_attachment')!.handler(args);

      expect(invoiceScansService.completeFileAttachment).toHaveBeenCalledWith(ID, {
        key: args.key,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      });
    });

    it('rejects a missing upload key before finalization reaches the service', () => {
      const { tools, invoiceScansService } = registerTools();

      expect(
        parse(tools.get('complete_invoice_scan_file_attachment')!.schema, {
          id: ID,
          ...file,
        }).success,
      ).toBe(false);
      expect(invoiceScansService.completeFileAttachment).not.toHaveBeenCalled();
    });

    it.each([
      ['a type the bucket does not take', { contentType: 'application/zip' }],
      ['a file over 5 MB', { sizeBytes: 5 * 1024 * 1024 + 1 }],
      ['an empty file', { sizeBytes: 0 }],
    ])('rejects %s', (_label, override) => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('attach_invoice_scan_file')!.schema, {
          id: ID,
          ...file,
          ...override,
        }).success,
      ).toBe(false);
    });
  });

  it('reads the list and a single record through the service', async () => {
    const { tools, invoiceScansService } = registerTools();

    await tools.get('list_invoice_scans')!.handler({});
    await tools.get('get_invoice_scan')!.handler({ id: ID });
    await tools.get('get_invoice_scan_download_url')!.handler({ id: ID });
    await tools.get('rescan_invoice_scan')!.handler({ id: ID });

    expect(invoiceScansService.list).toHaveBeenCalled();
    expect(invoiceScansService.get).toHaveBeenCalledWith(ID);
    expect(invoiceScansService.getDownloadUrl).toHaveBeenCalledWith(ID);
    expect(invoiceScansService.scan).toHaveBeenCalledWith(ID);
  });

  it('warns in its own description that deleting cannot be undone', () => {
    const { tools } = registerTools();

    expect(tools.get('delete_invoice_scan')!.description).toContain(
      'NO SE PUEDE DESHACER',
    );
  });
});
