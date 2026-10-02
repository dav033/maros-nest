import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerNoteReferenceTools } from './note-references';

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

  const noteReferencesService = {
    listForPage: jest.fn().mockResolvedValue([]),
    listBacklinks: jest.fn().mockResolvedValue([]),
    listNotesReferencing: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue([]),
    addRelation: jest.fn().mockResolvedValue([]),
    removeRelation: jest.fn().mockResolvedValue([]),
  };

  registerNoteReferenceTools(server as unknown as McpServer, {
    noteReferencesService,
  } as unknown as McpToolDeps);

  return { tools, noteReferencesService };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

function tool(name: string) {
  const { tools, noteReferencesService } = registerTools();
  const found = tools.get(name);
  if (!found) throw new Error(`${name} was not registered`);
  return { tool: found, noteReferencesService };
}

describe('registerNoteReferenceTools', () => {
  it('registers the six reference tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'notes_add_relation',
      'notes_list_backlinks',
      'notes_list_notes_referencing',
      'notes_list_references',
      'notes_remove_relation',
      'notes_search_reference_targets',
    ]);
  });

  /**
   * Una mención vive dentro del documento TipTap y el índice se reconstruye en cada
   * guardado. Una tool que insertara filas sueltas crearía referencias que el siguiente
   * guardado borraría, así que no existe a propósito.
   */
  it('does not offer a way to write an inline mention outside the document', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].some((name) => name.includes('mention'))).toBe(false);
  });

  it('reads a note outgoing references', async () => {
    const { tool: listReferences, noteReferencesService } = tool('notes_list_references');

    await listReferences.handler({ id: 1 });

    expect(noteReferencesService.listForPage).toHaveBeenCalledWith(1);
  });

  it('reads the notes linking to a note', async () => {
    const { tool: backlinks, noteReferencesService } = tool('notes_list_backlinks');

    await backlinks.handler({ id: 1 });

    expect(noteReferencesService.listBacklinks).toHaveBeenCalledWith(1);
  });

  it('asks for both origins when none are given', async () => {
    const { tool: referencing, noteReferencesService } = tool('notes_list_notes_referencing');

    await referencing.handler({ kind: 'lead', targetId: 42 });

    expect(noteReferencesService.listNotesReferencing).toHaveBeenCalledWith(
      'lead',
      42,
      undefined,
      [],
    );
  });

  it('passes the origins through when they are given', async () => {
    const { tool: referencing, noteReferencesService } = tool('notes_list_notes_referencing');

    await referencing.handler({ kind: 'task', targetId: 9, origins: ['inline'] });

    expect(noteReferencesService.listNotesReferencing).toHaveBeenCalledWith('task', 9, undefined, [
      'inline',
    ]);
  });

  it('searches every kind with an empty query by default', async () => {
    const { tool: search, noteReferencesService } = tool('notes_search_reference_targets');

    await search.handler({});

    expect(noteReferencesService.search).toHaveBeenCalledWith('', [], 5);
  });

  it('pins and unpins a record', async () => {
    const { tool: add, noteReferencesService: addDeps } = tool('notes_add_relation');
    await add.handler({ id: 1, kind: 'company', targetId: 8 });
    expect(addDeps.addRelation).toHaveBeenCalledWith(1, 'company', 8);

    const { tool: remove, noteReferencesService: removeDeps } = tool('notes_remove_relation');
    await remove.handler({ id: 1, kind: 'company', targetId: 8 });
    expect(removeDeps.removeRelation).toHaveBeenCalledWith(1, 'company', 8);
  });

  describe('schemas', () => {
    it('accepts every referenceable kind, including the three the entity link cannot hold', () => {
      const { tool: add } = tool('notes_add_relation');

      for (const kind of ['lead', 'project', 'contact', 'company', 'task', 'user', 'note']) {
        expect(parse(add.schema, { id: 1, kind, targetId: 2 }).success).toBe(true);
      }
    });

    it('rejects a kind that is not referenceable', () => {
      const { tool: add } = tool('notes_add_relation');

      expect(parse(add.schema, { id: 1, kind: 'invoice', targetId: 2 }).success).toBe(false);
    });

    it('rejects a non-positive id, so a typo cannot be read as "all of them"', () => {
      const { tool: add } = tool('notes_add_relation');

      expect(parse(add.schema, { id: 0, kind: 'lead', targetId: 2 }).success).toBe(false);
      expect(parse(add.schema, { id: 1, kind: 'lead', targetId: -3 }).success).toBe(false);
    });

    it('caps perKind so one call cannot drag the whole CRM back', () => {
      const { tool: search } = tool('notes_search_reference_targets');

      expect(parse(search.schema, { perKind: 25 }).success).toBe(true);
      expect(parse(search.schema, { perKind: 200 }).success).toBe(false);
    });
  });
});
