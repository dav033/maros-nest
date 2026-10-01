import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerTaskAdvancedTools } from './tasks-advanced';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

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

  const tasksService = {
    listWatchers: jest.fn().mockResolvedValue([]),
    addWatcher: jest.fn().mockResolvedValue([]),
    removeWatcher: jest.fn().mockResolvedValue([]),
    listParties: jest.fn().mockResolvedValue([]),
    setParties: jest.fn().mockResolvedValue([]),
    getByParty: jest.fn().mockResolvedValue([]),
    startTimer: jest.fn().mockResolvedValue({}),
    stopTimer: jest.fn().mockResolvedValue({}),
    addAttachments: jest.fn().mockResolvedValue({}),
    removeAttachment: jest.fn().mockResolvedValue({}),
    reorderAttachments: jest.fn().mockResolvedValue({}),
    reorderSubtask: jest.fn().mockResolvedValue({}),
    addLabelsToTask: jest.fn().mockResolvedValue({}),
    bulkSetAssignee: jest.fn().mockResolvedValue({ updated: 2 }),
    bulkSetStatus: jest.fn().mockResolvedValue({ updated: 2 }),
    bulkAddLabels: jest.fn().mockResolvedValue({ updated: 2 }),
    bulkDelete: jest.fn().mockResolvedValue({ deleted: 2 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const taskDependencies = {
    list: jest.fn().mockResolvedValue([]),
    replace: jest.fn().mockResolvedValue([]),
  };
  const mcpActor = { taskActor: jest.fn().mockResolvedValue(MCP_ACTOR) };

  registerTaskAdvancedTools(server as unknown as McpServer, {
    tasksService,
    taskDependencies,
    mcpActor,
  } as unknown as McpToolDeps);

  return { tools, tasksService, taskDependencies };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

describe('registerTaskAdvancedTools', () => {
  it('registers the twenty remaining task operations', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'add_labels_to_task',
      'add_task_attachments',
      'add_task_watcher',
      'bulk_add_task_labels',
      'bulk_delete_tasks',
      'bulk_set_task_assignee',
      'bulk_set_task_status',
      'delete_task',
      'get_tasks_by_party',
      'list_task_dependencies',
      'list_task_parties',
      'list_task_watchers',
      'remove_task_attachment',
      'remove_task_watcher',
      'reorder_subtask',
      'reorder_task_attachments',
      'set_task_dependencies',
      'set_task_parties',
      'start_task_timer',
      'stop_task_timer',
    ]);
  });

  // getMine() resuelve contra el actor, y el actor del MCP es un usuario de
  // sistema que nunca tiene tareas: una tool asi devolveria siempre vacio.
  it('does not expose "my tasks", which would always be empty for the agent', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].some((n) => n.includes('my_task'))).toBe(false);
  });

  describe('destructive operations need confirming', () => {
    it.each([
      ['delete_task without confirm', 'delete_task', { id: 1 }],
      ['delete_task with confirm false', 'delete_task', { id: 1, confirm: false }],
      ['bulk_delete_tasks without confirm', 'bulk_delete_tasks', { taskIds: [1, 2] }],
    ])('refuses %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('deletes one task when confirmed', async () => {
      const { tools, tasksService } = registerTools();

      await expect(callJson(tools.get('delete_task')!, { id: 1, confirm: true })).resolves.toEqual(
        { id: 1, deleted: true },
      );
      expect(tasksService.delete).toHaveBeenCalledWith(1, MCP_ACTOR);
    });

    it('deletes in bulk when confirmed', async () => {
      const { tools, tasksService } = registerTools();

      await tools.get('bulk_delete_tasks')!.handler({ taskIds: [1, 2], confirm: true });

      expect(tasksService.bulkDelete).toHaveBeenCalledWith([1, 2], MCP_ACTOR);
    });
  });

  it('passes blockedReason through on a bulk status change', async () => {
    const { tools, tasksService } = registerTools();

    await tools
      .get('bulk_set_task_status')!
      .handler({ taskIds: [1, 2], status: 'blocked', blockedReason: 'Waiting on the permit' });

    expect(tasksService.bulkSetStatus).toHaveBeenCalledWith(
      [1, 2],
      'blocked',
      'Waiting on the permit',
      MCP_ACTOR,
    );
  });

  it('wraps the parties list in the shape the service expects', async () => {
    const { tools, tasksService } = registerTools();
    const parties = [{ partyKind: 'company', partyId: 4, role: 'subcontractor' }];

    await tools.get('set_task_parties')!.handler({ id: 1, parties });

    expect(tasksService.setParties).toHaveBeenCalledWith(1, { parties }, MCP_ACTOR);
  });

  it('replaces dependencies, and an empty list clears them', async () => {
    const { tools, taskDependencies } = registerTools();

    await tools.get('set_task_dependencies')!.handler({ id: 1, dependsOnTaskIds: [] });

    expect(taskDependencies.replace).toHaveBeenCalledWith(1, []);
  });

  describe('validation', () => {
    it.each([
      ['a party kind that does not exist', 'set_task_parties', {
        id: 1,
        parties: [{ partyKind: 'vendor', partyId: 1 }],
      }],
      ['an empty bulk selection', 'bulk_set_task_assignee', { taskIds: [], userId: 1 }],
      ['more than 500 tasks at once', 'bulk_add_task_labels', {
        taskIds: Array.from({ length: 501 }, (_, i) => i + 1),
        labelIds: [1],
      }],
      ['a status that is not a column', 'bulk_set_task_status', {
        taskIds: [1],
        status: 'nearly',
      }],
      ['an empty attachment key', 'add_task_attachments', { id: 1, keys: ['  '] }],
      ['no labels to add', 'add_labels_to_task', { id: 1, labelIds: [] }],
    ])('rejects %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('accepts a null assignee in bulk to unassign everything', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('bulk_set_task_assignee')!.schema, {
          taskIds: [1, 2],
          userId: null,
        }).success,
      ).toBe(true);
    });
  });

  it('says in its own text that bulk deleting is the most destructive call', () => {
    const { tools } = registerTools();

    expect(tools.get('bulk_delete_tasks')!.description).toContain('NO SE PUEDE DESHACER');
    expect(tools.get('delete_task')!.description).toContain('archive_task');
  });
});
