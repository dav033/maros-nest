import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerTaskTools } from './tasks';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MCP_ACTOR = { id: 42, canDelete: false };

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
    getBoard: jest.fn().mockResolvedValue({ columns: {}, doneTotalCount: 0 }),
    findAll: jest.fn().mockResolvedValue({ items: [], totalCount: 0, nextCursor: null }),
    getById: jest.fn().mockResolvedValue({ id: 1 }),
    getByEntity: jest.fn().mockResolvedValue([]),
    getSchedule: jest.fn().mockResolvedValue([]),
    findArchived: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    update: jest.fn().mockResolvedValue({ id: 1 }),
    move: jest.fn().mockResolvedValue({ id: 1 }),
    setAssignee: jest.fn().mockResolvedValue({ id: 1 }),
    setLabels: jest.fn().mockResolvedValue({ id: 1 }),
    setEntityLink: jest.fn().mockResolvedValue({ id: 1 }),
    schedule: jest.fn().mockResolvedValue({ id: 1 }),
    archive: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const taskCommentsService = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 9 }),
  };
  const mcpActor = {
    taskActor: jest.fn().mockResolvedValue(MCP_ACTOR),
    authenticatedUser: jest.fn().mockResolvedValue({ id: 42 }),
  };

  registerTaskTools(server as unknown as McpServer, {
    tasksService,
    taskCommentsService,
    mcpActor,
  } as unknown as McpToolDeps);

  return { tools, tasksService, taskCommentsService, mcpActor };
}

/** registerMcpTool envuelve el resultado en el sobre del MCP; esto lo abre. */
async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

describe('registerTaskTools', () => {
  it('registers the board tools and leaves deleting out', () => {
    const { tools } = registerTools();
    const names = [...tools.keys()];

    expect(names).toContain('get_task_board');
    expect(names).toContain('create_task');
    expect(names).toContain('move_task');
    expect(names).toContain('archive_task');
    expect(names).toContain('restore_task');
    // Archivar es reversible; borrar no, y el MCP no borra tareas.
    expect(names).not.toContain('delete_task');
    expect(names.filter((n) => n.startsWith('bulk_'))).toHaveLength(0);
  });

  describe('every write is signed by the MCP system user', () => {
    it('stamps create_task with it', async () => {
      const { tools, tasksService, mcpActor } = registerTools();

      await tools.get('create_task')!.handler({ title: 'Inspect the roof' });

      expect(mcpActor.taskActor).toHaveBeenCalled();
      expect(tasksService.create).toHaveBeenCalledWith(
        { title: 'Inspect the roof' },
        MCP_ACTOR,
      );
    });

    it('stamps a comment with it', async () => {
      const { tools, taskCommentsService } = registerTools();
      const body = { type: 'doc', content: [] };

      await tools.get('comment_on_task')!.handler({ taskId: 3, body });

      expect(taskCommentsService.create).toHaveBeenCalledWith(3, { body }, MCP_ACTOR);
    });
  });

  it('sends every field except the id as the task patch', async () => {
    const { tools, tasksService } = registerTools();

    await tools.get('update_task')!.handler({ id: 5, title: 'Renamed', priority: 'high' });

    expect(tasksService.update).toHaveBeenCalledWith(
      5,
      { title: 'Renamed', priority: 'high' },
      MCP_ACTOR,
    );
  });

  it('reports the archive as done instead of returning nothing', async () => {
    const { tools } = registerTools();

    await expect(callJson(tools.get('archive_task')!, { id: 7 })).resolves.toEqual({
      id: 7,
      archived: true,
    });
  });

  it('unlinks a task when both entity fields are null', async () => {
    const { tools, tasksService } = registerTools();

    await tools
      .get('set_task_entity')!
      .handler({ id: 2, entityKind: null, entityId: null });

    expect(tasksService.setEntityLink).toHaveBeenCalledWith(
      2,
      { entityKind: null, entityId: null },
      MCP_ACTOR,
    );
  });

  describe('validation, which is the only one that runs', () => {
    it.each([
      ['a status that is not a column', 'move_task', { id: 1, status: 'almost_done' }],
      ['a kind that does not exist', 'create_task', { kind: 'paperwork' }],
      ['a priority that does not exist', 'create_task', { priority: 'whenever' }],
      ['a date that is not ISO', 'create_task', { dueDate: '31/12/2026' }],
      ['an id of zero', 'get_task', { id: 0 }],
      ['an entity kind that does not exist', 'get_tasks_by_entity', {
        entityKind: 'invoice',
        entityId: 1,
      }],
    ])('rejects %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('accepts a plain day and a full timestamp as dates', () => {
      const { tools } = registerTools();

      expect(parse(tools.get('create_task')!.schema, { dueDate: '2026-12-31' }).success).toBe(
        true,
      );
      expect(
        parse(tools.get('create_task')!.schema, { dueDate: '2026-12-31T10:30:00Z' }).success,
      ).toBe(true);
    });

    it('takes a null assignee to unassign', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('set_task_assignee')!.schema, { id: 1, userId: null }).success,
      ).toBe(true);
    });
  });
});
