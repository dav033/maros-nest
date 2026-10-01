import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerNoteAdvancedTools } from './notes-advanced';

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

  const notesService = {
    getTrash: jest.fn().mockResolvedValue([]),
    updateNoteContent: jest.fn().mockResolvedValue({ id: 1 }),
    setEntityLink: jest.fn().mockResolvedValue({ id: 1 }),
    setTags: jest.fn().mockResolvedValue({ id: 1 }),
    setVisibility: jest.fn().mockResolvedValue({ id: 1 }),
    purgeNote: jest.fn().mockResolvedValue(undefined),
  };
  const noteTagsService = {
    createTag: jest.fn().mockResolvedValue({ id: 2 }),
    updateTag: jest.fn().mockResolvedValue({ id: 2 }),
    deleteTag: jest.fn().mockResolvedValue(undefined),
  };

  registerNoteAdvancedTools(server as unknown as McpServer, {
    notesService,
    noteTagsService,
  } as unknown as McpToolDeps);

  return { tools, notesService, noteTagsService };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

describe('registerNoteAdvancedTools', () => {
  it('registers the nine remaining note tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'notes_create_tag',
      'notes_delete_tag',
      'notes_list_trash',
      'notes_purge_page',
      'notes_replace_content',
      'notes_set_entity',
      'notes_set_tags',
      'notes_set_visibility',
      'notes_update_tag',
    ]);
  });

  // setFavorite sin actor entra en un `if (actor)` y no hace nada, sin error: la
  // tool devolveria exito sin haber marcado nada. Y los compartidos son permisos
  // entre personas concretas, que un agente sin identidad no deberia conceder.
  it('leaves out what would silently do nothing or hand out access', () => {
    const { tools } = registerTools();
    const names = [...tools.keys()];

    for (const forbidden of [
      'notes_set_favorite',
      'notes_list_favorites',
      'notes_shared_with_me',
      'notes_create_share',
      'notes_create_public_link',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('replaces content and forwards the optimistic-lock timestamp', async () => {
    const { tools, notesService } = registerTools();
    const content = { type: 'doc', content: [] };

    await tools
      .get('notes_replace_content')!
      .handler({ id: 1, content, expectedUpdatedAt: '2026-10-01T12:00:00.000Z' });

    expect(notesService.updateNoteContent).toHaveBeenCalledWith(1, {
      content,
      expectedUpdatedAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('unlinks a note when both entity fields are null', async () => {
    const { tools, notesService } = registerTools();

    await tools.get('notes_set_entity')!.handler({ id: 1, entityKind: null, entityId: null });

    expect(notesService.setEntityLink).toHaveBeenCalledWith(1, {
      entityKind: null,
      entityId: null,
    });
  });

  it('clears the tags with an empty list', async () => {
    const { tools, notesService } = registerTools();

    await tools.get('notes_set_tags')!.handler({ id: 1, tagIds: [] });

    expect(notesService.setTags).toHaveBeenCalledWith(1, []);
  });

  it('purges only when confirmed, and says so', async () => {
    const { tools, notesService } = registerTools();

    expect(parse(tools.get('notes_purge_page')!.schema, { id: 1 }).success).toBe(false);
    await expect(callJson(tools.get('notes_purge_page')!, { id: 1, confirm: true })).resolves.toEqual(
      { id: 1, purged: true },
    );
    expect(notesService.purgeNote).toHaveBeenCalledWith(1);
    expect(tools.get('notes_purge_page')!.description).toContain('notes_trash_page');
  });

  describe('validation', () => {
    it.each([
      ['a visibility that does not exist', 'notes_set_visibility', {
        id: 1,
        visibility: 'public',
      }],
      ['an entity kind that does not exist', 'notes_set_entity', {
        id: 1,
        entityKind: 'invoice',
        entityId: 1,
      }],
      ['a tag colour that does not exist', 'notes_create_tag', {
        name: 'Urgent',
        color: 'gold',
      }],
      ['an empty tag name', 'notes_create_tag', { name: '   ' }],
      ['a tag deletion without confirm', 'notes_delete_tag', { id: 1 }],
      ['content that is not an object', 'notes_replace_content', { id: 1, content: 'texto' }],
    ])('rejects %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('accepts both real visibilities', () => {
      const { tools } = registerTools();

      for (const visibility of ['private', 'team']) {
        expect(
          parse(tools.get('notes_set_visibility')!.schema, { id: 1, visibility }).success,
        ).toBe(true);
      }
    });
  });
});
