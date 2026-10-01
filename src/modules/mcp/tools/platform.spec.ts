import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerPlatformTools } from './platform';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MCP_USER = { id: 17, email: 'mcp-agent@maros.invalid' };

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

  const companyServicesService = {
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 1 }),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    update: jest.fn().mockResolvedValue({ id: 1 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const notificationsService = {
    list: jest.fn().mockResolvedValue([]),
    unreadCount: jest.fn().mockResolvedValue(3),
    markRead: jest.fn().mockResolvedValue(undefined),
    markAllRead: jest.fn().mockResolvedValue(undefined),
  };
  const managedFilesService = {
    createIntent: jest.fn().mockResolvedValue({ file: {}, uploadUrl: 'u' }),
    complete: jest.fn().mockResolvedValue({}),
    retry: jest.fn().mockResolvedValue({ file: {}, uploadUrl: 'u' }),
    getDownloadUrl: jest.fn().mockResolvedValue({ url: 'u' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const restorationVisitService = {
    generateRestorationVisitUrl: jest.fn().mockReturnValue({ url: 'https://x/y' }),
    getRestorationVisitFromBase64: jest.fn().mockResolvedValue({}),
  };
  const mcpActor = { authenticatedUser: jest.fn().mockResolvedValue(MCP_USER) };

  registerPlatformTools(server as unknown as McpServer, {
    companyServicesService,
    notificationsService,
    managedFilesService,
    restorationVisitService,
    mcpActor,
  } as unknown as McpToolDeps);

  return {
    tools,
    companyServicesService,
    notificationsService,
    managedFilesService,
    restorationVisitService,
  };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

describe('registerPlatformTools', () => {
  it('registers the sixteen leftover tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'complete_file_upload',
      'create_company_service',
      'create_file_upload_intent',
      'delete_company_service',
      'delete_managed_file',
      'generate_restoration_visit_url',
      'get_company_service',
      'get_file_download_url',
      'get_user_unread_notification_count',
      'list_company_services',
      'list_user_notifications',
      'mark_all_notifications_read',
      'mark_notification_read',
      'read_restoration_visit_url',
      'retry_file_upload',
      'update_company_service',
    ]);
  });

  // Las notificaciones son por persona y el usuario de sistema del MCP no tiene
  // ninguna: firmarlas con el seria inutil, asi que el userId es explicito.
  describe('notifications ask whose they are', () => {
    it('requires a userId on every one of them', () => {
      const { tools } = registerTools();

      for (const name of [
        'list_user_notifications',
        'get_user_unread_notification_count',
        'mark_notification_read',
        'mark_all_notifications_read',
      ]) {
        expect(parse(tools.get(name)!.schema, {}).success).toBe(false);
      }
    });

    it('defaults to all notifications, not only the unread ones', async () => {
      const { tools, notificationsService } = registerTools();

      await tools.get('list_user_notifications')!.handler({ userId: 4 });

      expect(notificationsService.list).toHaveBeenCalledWith(4, false, undefined);
    });

    it('returns the count next to whose it is', async () => {
      const { tools } = registerTools();

      await expect(
        callJson(tools.get('get_user_unread_notification_count')!, { userId: 4 }),
      ).resolves.toEqual({ userId: 4, count: 3 });
    });

    it('marks one as read for that person, not globally', async () => {
      const { tools, notificationsService } = registerTools();

      await tools.get('mark_notification_read')!.handler({ userId: 4, notificationId: 9 });

      expect(notificationsService.markRead).toHaveBeenCalledWith(9, 4);
    });
  });

  it('creates an upload intent on behalf of the MCP system user', async () => {
    const { tools, managedFilesService } = registerTools();
    const dto = { fileName: 'plan.pdf', contentType: 'application/pdf', sizeBytes: 1024 };

    await tools.get('create_file_upload_intent')!.handler(dto);

    expect(managedFilesService.createIntent).toHaveBeenCalledWith(dto, MCP_USER);
  });

  it('reads a restoration visit URL back, and generating one is synchronous', async () => {
    const { tools, restorationVisitService } = registerTools();

    await expect(
      callJson(tools.get('generate_restoration_visit_url')!, { data: { client: 'Smith' } }),
    ).resolves.toEqual({ url: 'https://x/y' });
    expect(restorationVisitService.generateRestorationVisitUrl).toHaveBeenCalledWith({
      client: 'Smith',
    });

    await tools.get('read_restoration_visit_url')!.handler({ base64Data: 'eyJ9' });
    expect(restorationVisitService.getRestorationVisitFromBase64).toHaveBeenCalledWith('eyJ9');
  });

  describe('the two deletions need confirming', () => {
    it.each([
      ['a catalogue service', 'delete_company_service', { id: 1 }],
      ['a managed file', 'delete_managed_file', { id: 1 }],
    ])('refuses to delete %s without confirm', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('deletes when confirmed', async () => {
      const { tools, companyServicesService, managedFilesService } = registerTools();

      await callJson(tools.get('delete_company_service')!, { id: 1, confirm: true });
      await callJson(tools.get('delete_managed_file')!, { id: 2, confirm: true });

      expect(companyServicesService.delete).toHaveBeenCalledWith(1);
      expect(managedFilesService.remove).toHaveBeenCalledWith(2);
    });
  });

  it('refuses an empty catalogue service name', () => {
    const { tools } = registerTools();

    expect(parse(tools.get('create_company_service')!.schema, { name: '   ' }).success).toBe(
      false,
    );
  });
});
