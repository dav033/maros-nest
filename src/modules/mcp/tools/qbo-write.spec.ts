import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerQboWriteTools } from './qbo-write';

type Registered = { schema: ZodRawShape; handler: (args: Record<string, unknown>) => Promise<unknown> };

function setup() {
  const tools = new Map<string, Registered>();
  const server = {
    tool: (name: string, _d: string, schema: ZodRawShape, handler: Registered['handler']) => {
      tools.set(name, { schema, handler });
    },
  };
  const qboWriteService = {
    attachScanFile: jest.fn().mockResolvedValue({ executed: false }),
    updatePrivateNote: jest.fn().mockResolvedValue({ executed: false }),
    previewBill: jest.fn().mockResolvedValue({ ready: false }),
  };
  const qboFinancials = { getDefaultRealmId: jest.fn().mockResolvedValue('REALM-1') };
  registerQboWriteTools(server as unknown as McpServer, { qboWriteService, qboFinancials } as unknown as McpToolDeps);
  return { tools, qboWriteService };
}

const parse = (schema: ZodRawShape, args: unknown) => z.object(schema).safeParse(args);
const ID = '8c81e542-2141-4ba4-b4f4-fb442eb2fafe';

describe('registerQboWriteTools', () => {
  it('registers the three tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual(['qbo_attach_invoice_scan_file', 'qbo_preview_bill_from_scan', 'qbo_update_transaction_note']);
  });

  describe('qbo_attach_invoice_scan_file', () => {
    const base = { invoiceScanId: ID, entityType: 'Bill', entityId: '123' };

    it('defaults to a preview (confirm false) on the default realm', async () => {
      const { tools, qboWriteService } = setup();
      const tool = tools.get('qbo_attach_invoice_scan_file')!;

      expect(parse(tool.schema, base).success).toBe(true);
      await tool.handler({ ...base, confirm: false });

      expect(qboWriteService.attachScanFile).toHaveBeenCalledWith('REALM-1', { ...base, confirm: false });
    });

    it('only runs when confirm is exactly true', async () => {
      const { tools, qboWriteService } = setup();

      await tools.get('qbo_attach_invoice_scan_file')!.handler({ ...base, confirm: true });
      await tools.get('qbo_attach_invoice_scan_file')!.handler({ ...base, confirm: 'yes' });

      expect(qboWriteService.attachScanFile.mock.calls[0][1].confirm).toBe(true);
      expect(qboWriteService.attachScanFile.mock.calls[1][1].confirm).toBe(false);
    });

    it.each([
      ['a non-uuid scan', { invoiceScanId: 'abc' }],
      ['an entity type that is not attachable', { entityType: 'Account' }],
      ['a non-numeric id', { entityId: "1' or '1'='1" }],
    ])('rejects %s', (_label, override) => {
      expect(parse(setup().tools.get('qbo_attach_invoice_scan_file')!.schema, { ...base, ...override }).success).toBe(false);
    });
  });

  describe('qbo_update_transaction_note', () => {
    const base = { entityType: 'Bill', entityId: '123', note: 'Checked' };

    it('defaults to append and to a preview', async () => {
      const { tools, qboWriteService } = setup();
      const tool = tools.get('qbo_update_transaction_note')!;

      await tool.handler({ ...base });

      expect(qboWriteService.updatePrivateNote).toHaveBeenCalledWith('REALM-1', { ...base, mode: 'append', confirm: false });
    });

    it.each([
      ['an empty note', { note: ' ' }],
      ['a note over 1000 characters', { note: 'x'.repeat(1001) }],
      ['an entity type outside the allowed list', { entityType: 'JournalEntry' }],
      ['a bad mode', { mode: 'delete' }],
    ])('rejects %s', (_label, override) => {
      expect(parse(setup().tools.get('qbo_update_transaction_note')!.schema, { ...base, ...override }).success).toBe(false);
    });
  });

  describe('qbo_preview_bill_from_scan', () => {
    it('forwards the account id and never needs confirm', async () => {
      const { tools, qboWriteService } = setup();
      const tool = tools.get('qbo_preview_bill_from_scan')!;

      expect(parse(tool.schema, { invoiceScanId: ID, accountId: '54' }).success).toBe(true);
      await tool.handler({ invoiceScanId: ID, accountId: '54' });

      expect(qboWriteService.previewBill).toHaveBeenCalledWith('REALM-1', { invoiceScanId: ID, accountId: '54' });
    });

    it('rejects a malformed account id', () => {
      expect(parse(setup().tools.get('qbo_preview_bill_from_scan')!.schema, { invoiceScanId: ID, accountId: 'x;y' }).success).toBe(false);
    });
  });
});
