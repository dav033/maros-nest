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
    attachFile: jest.fn().mockResolvedValue({ id: 'x', uploadUrl: 'u' }),
    scan: jest.fn().mockResolvedValue({ id: 'x' }),
    remove: jest.fn().mockResolvedValue({ id: 'x', deleted: true }),
  };

  registerInvoiceScanTools(server as unknown as McpServer, {
    invoiceScansService,
  } as unknown as McpToolDeps);

  return { tools, invoiceScansService };
}

const ID = '8c81e542-2141-4ba4-b4f4-fb442eb2fafe';

/** Corre el esquema de la tool como lo haría el SDK antes de llamar al handler. */
function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

describe('registerInvoiceScanTools', () => {
  it('registers the eight document-scan tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'attach_invoice_scan_file',
      'create_manual_transaction',
      'delete_invoice_scan',
      'get_invoice_scan',
      'get_invoice_scan_download_url',
      'list_invoice_scans',
      'rescan_invoice_scan',
      'update_invoice_scan',
    ]);
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

      expect(invoiceScansService.attachFile).toHaveBeenCalledWith(ID, file);
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
