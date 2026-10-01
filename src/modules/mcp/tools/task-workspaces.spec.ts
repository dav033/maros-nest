import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerTaskWorkspaceTools } from './task-workspaces';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MCP_USER = { id: 17, email: 'mcp-agent@maros.invalid' };
const MCP_ACTOR = { id: 17, canDelete: false };

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

  const taskWorkspacesService = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 1 }),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    update: jest.fn().mockResolvedValue({ id: 1 }),
    archive: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn().mockResolvedValue({ id: 1 }),
    addLinks: jest.fn().mockResolvedValue({ id: 1 }),
    removeLink: jest.fn().mockResolvedValue(undefined),
    moveTask: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const taskWorkspaceFolders = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 2 }),
    update: jest.fn().mockResolvedValue({ id: 2 }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const taskWorkspaceAssignment = { listOptions: jest.fn().mockResolvedValue([]) };
  const taskLabelsService = {
    listLabels: jest.fn().mockResolvedValue([]),
    createLabel: jest.fn().mockResolvedValue({ id: 3 }),
    updateLabel: jest.fn().mockResolvedValue({ id: 3 }),
    deleteLabel: jest.fn().mockResolvedValue(undefined),
  };
  const taskTemplatesService = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 4 }),
    apply: jest.fn().mockResolvedValue([{ id: 10 }]),
  };
  const mcpActor = {
    authenticatedUser: jest.fn().mockResolvedValue(MCP_USER),
    taskActor: jest.fn().mockResolvedValue(MCP_ACTOR),
  };

  registerTaskWorkspaceTools(server as unknown as McpServer, {
    taskWorkspacesService,
    taskWorkspaceFolders,
    taskWorkspaceAssignment,
    taskLabelsService,
    taskTemplatesService,
    mcpActor,
  } as unknown as McpToolDeps);

  return {
    tools,
    taskWorkspacesService,
    taskWorkspaceFolders,
    taskLabelsService,
    taskTemplatesService,
  };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

describe('registerTaskWorkspaceTools', () => {
  it('registers the twenty-one organising tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'add_task_workspace_links',
      'apply_task_template',
      'archive_task_workspace',
      'create_task_label',
      'create_task_template',
      'create_task_workspace',
      'create_task_workspace_folder',
      'delete_task_label',
      'delete_task_workspace_folder',
      'get_task_workspace',
      'get_task_workspace_options',
      'list_task_labels',
      'list_task_templates',
      'list_task_workspace_folders',
      'list_task_workspaces',
      'move_task_to_folder',
      'remove_task_workspace_link',
      'restore_task_workspace',
      'update_task_label',
      'update_task_workspace',
      'update_task_workspace_folder',
    ]);
  });

  // La razon de ser de este grupo: create_task acepta workspaceId, folderId y
  // labelIds, y antes no habia forma de averiguar que valores existen.
  it('makes the ids that create_task needs discoverable', () => {
    const { tools } = registerTools();

    expect(tools.has('get_task_workspace_options')).toBe(true);
    expect(tools.has('list_task_workspace_folders')).toBe(true);
    expect(tools.has('list_task_labels')).toBe(true);
  });

  it('creates a workspace as the MCP system user', async () => {
    const { tools, taskWorkspacesService } = registerTools();

    await tools.get('create_task_workspace')!.handler({ title: 'Smith remodel' });

    expect(taskWorkspacesService.create).toHaveBeenCalledWith(
      { title: 'Smith remodel' },
      MCP_USER,
    );
  });

  it('applies a template with the MCP task actor', async () => {
    const { tools, taskTemplatesService } = registerTools();

    await tools
      .get('apply_task_template')!
      .handler({ templateId: 4, leadId: 9, startDate: '2026-11-02' });

    expect(taskTemplatesService.apply).toHaveBeenCalledWith(4, 9, '2026-11-02', MCP_ACTOR);
  });

  it('separates the workspace id from the folder patch', async () => {
    const { tools, taskWorkspaceFolders } = registerTools();

    await tools
      .get('update_task_workspace_folder')!
      .handler({ workspaceId: 1, folderId: 2, title: 'Permits' });

    expect(taskWorkspaceFolders.update).toHaveBeenCalledWith(1, 2, { title: 'Permits' });
  });

  it('passes the destination folder when deleting one', async () => {
    const { tools, taskWorkspaceFolders } = registerTools();

    await expect(
      callJson(tools.get('delete_task_workspace_folder')!, {
        workspaceId: 1,
        folderId: 2,
        destinationFolderId: 5,
        confirm: true,
      }),
    ).resolves.toEqual({ workspaceId: 1, folderId: 2, deleted: true });
    expect(taskWorkspaceFolders.remove).toHaveBeenCalledWith(1, 2, 5);
  });

  it('reports archiving and unlinking as done instead of returning nothing', async () => {
    const { tools } = registerTools();

    await expect(callJson(tools.get('archive_task_workspace')!, { id: 1 })).resolves.toEqual(
      { id: 1, archived: true },
    );
    await expect(
      callJson(tools.get('remove_task_workspace_link')!, {
        id: 1,
        entityKind: 'project',
        entityId: 3,
      }),
    ).resolves.toEqual({ id: 1, entityKind: 'project', entityId: 3, removed: true });
  });

  describe('validation', () => {
    it.each([
      ['a label colour that does not exist', 'create_task_label', {
        name: 'Urgent',
        color: 'fuchsia',
      }],
      ['an empty label name', 'create_task_label', { name: '   ' }],
      ['an entity kind that does not exist', 'add_task_workspace_links', {
        id: 1,
        links: [{ entityKind: 'invoice', entityId: 1 }],
      }],
      ['a relationship that does not exist', 'add_task_workspace_links', {
        id: 1,
        links: [{ entityKind: 'project', entityId: 1, relationship: 'owner' }],
      }],
      ['no links at all', 'add_task_workspace_links', { id: 1, links: [] }],
      ['a template with no items', 'create_task_template', { name: 'Empty', items: [] }],
      ['a negative offsetDays', 'create_task_template', {
        name: 'Standard',
        items: [{ title: 'Permit', offsetDays: -1 }],
      }],
      ['a label deletion without confirm', 'delete_task_label', { id: 3 }],
      ['a folder deletion without confirm', 'delete_task_workspace_folder', {
        workspaceId: 1,
        folderId: 2,
      }],
    ])('rejects %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('accepts a null folder to move a task to the workspace root', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('move_task_to_folder')!.schema, {
          workspaceId: 1,
          taskId: 2,
          folderId: null,
        }).success,
      ).toBe(true);
    });
  });
});
