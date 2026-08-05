import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { extractPlainTextFromTipTapDoc } from '../../../common/utils/tiptap-text.util';
import { NOTE_ENTITY_KINDS } from '../../notes/note-management/dto/create-note.dto';

/** Converts plain, newline-separated text into a minimal-but-valid TipTap document. */
function linesToTipTapDoc(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

/** Appends new paragraphs to the end of an existing TipTap document. */
function appendLinesToTipTapDoc(
  doc: Record<string, unknown>,
  text: string,
): Record<string, unknown> {
  const docContent = (doc as { content?: unknown[] }).content;
  const existing = Array.isArray(docContent) ? docContent : [];
  const appended = text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }));
  return { type: 'doc', content: [...existing, ...appended] };
}

export function registerNoteTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'notes_search',
    'Full-text search over note page titles and content',
    {
      query: z.string().describe('Search text'),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ query, limit }: { query: string; limit?: number }) =>
      deps.notesService.searchNotes(query, limit ?? 20),
  );

  registerMcpTool(
    server,
    'notes_list_tree',
    'List all active note pages as a flat array (id, parentId, title, position, tags)',
    {},
    async () => deps.notesService.getAllNotes(),
  );

  registerMcpTool(
    server,
    'notes_list_by_entity',
    'List note pages linked to a CRM entity (lead, project, contact, or company)',
    {
      entityKind: z.enum(NOTE_ENTITY_KINDS).describe('CRM entity kind'),
      entityId: z.number().describe('CRM entity ID'),
    },
    async ({ entityKind, entityId }: { entityKind: string; entityId: number }) =>
      deps.notesService.getNotesByEntity(entityKind, entityId),
  );

  registerMcpTool(
    server,
    'notes_list_tags',
    'List all note tags',
    {},
    async () => deps.noteTagsService.listTags(),
  );

  registerMcpTool(
    server,
    'notes_get_page',
    'Get a note page by id. Returns plain-text content by default (not the raw ' +
      'ProseMirror JSON) — pass includeJson to also get the full document structure',
    {
      pageId: z.number().describe('Note page ID'),
      includeJson: z.boolean().optional().describe('Also include the raw TipTap JSON'),
    },
    async ({ pageId, includeJson }: { pageId: number; includeJson?: boolean }) => {
      const page = await deps.notesService.getNoteById(pageId);
      const result = {
        id: page.id,
        title: page.title,
        icon: page.icon,
        parentId: page.parentId,
        tags: page.tags,
        entityKind: page.entityKind,
        entityId: page.entityId,
        updatedAt: page.updatedAt,
        contentText: extractPlainTextFromTipTapDoc(page.content),
        contentJson: includeJson ? page.content : undefined,
      };
      return result;
    },
  );

  registerMcpTool(
    server,
    'notes_create_page',
    'Create a note page. Provide `text` as plain, newline-separated paragraphs — never ' +
      'hand-write ProseMirror/TipTap JSON, it will not be accepted',
    {
      title: z.string().optional().describe('Page title (default "Untitled")'),
      parentId: z.number().optional().describe('Parent page id, for a nested page'),
      entityKind: z.enum(NOTE_ENTITY_KINDS).optional().describe('CRM entity kind to link'),
      entityId: z.number().optional().describe('CRM entity id to link'),
      text: z.string().optional().describe('Initial content as plain text (one paragraph per line)'),
    },
    async ({
      title,
      parentId,
      entityKind,
      entityId,
      text,
    }: {
      title?: string;
      parentId?: number;
      entityKind?: string;
      entityId?: number;
      text?: string;
    }) => {
      const page: { id: number } = await deps.notesService.createNote({
        title,
        parentId,
        entityKind: entityKind as never,
        entityId,
      });
      if (text) {
        return deps.notesService.updateNoteContent(page.id, {
          content: linesToTipTapDoc(text),
        });
      }
      return page;
    },
  );

  registerMcpTool(
    server,
    'notes_append_to_page',
    'Append plain-text paragraphs to the end of an existing note page — the most common ' +
      'way to log something under an existing page (e.g. a call note under a lead)',
    {
      pageId: z.number().describe('Note page ID'),
      text: z.string().describe('Text to append (one paragraph per line)'),
    },
    async ({ pageId, text }: { pageId: number; text: string }) => {
      const page: { content: Record<string, unknown> } =
        await deps.notesService.getNoteById(pageId);
      const content = appendLinesToTipTapDoc(page.content, text);
      return deps.notesService.updateNoteContent(pageId, { content });
    },
  );

  registerMcpTool(
    server,
    'notes_rename_page',
    'Rename a note page and/or change its icon',
    {
      pageId: z.number().describe('Note page ID'),
      title: z.string().optional().describe('New title'),
      icon: z.string().optional().describe('New icon (emoji)'),
    },
    async ({ pageId, title, icon }: { pageId: number; title?: string; icon?: string }) =>
      deps.notesService.updateNote(pageId, { title, icon }),
  );

  registerMcpTool(
    server,
    'notes_move_page',
    'Move a note page to a new parent and/or position in the tree',
    {
      pageId: z.number().describe('Note page ID'),
      parentId: z.number().optional().describe('New parent id, omit for the root'),
      beforeId: z.number().optional().describe('Insert before this sibling id'),
      afterId: z.number().optional().describe('Insert after this sibling id'),
    },
    async ({
      pageId,
      parentId,
      beforeId,
      afterId,
    }: {
      pageId: number;
      parentId?: number;
      beforeId?: number;
      afterId?: number;
    }) =>
      deps.notesService.moveNote(pageId, {
        parentId: parentId ?? null,
        beforeId,
        afterId,
      }),
  );

  registerMcpTool(
    server,
    'notes_trash_page',
    'Move a note page (and its sub-pages) to the trash',
    { pageId: z.number().describe('Note page ID') },
    async ({ pageId }: { pageId: number }) => {
      await deps.notesService.trashNote(pageId);
      return { id: pageId, trashed: true };
    },
  );

  registerMcpTool(
    server,
    'notes_restore_page',
    'Restore a previously trashed note page (and its sub-pages)',
    { pageId: z.number().describe('Note page ID') },
    async ({ pageId }: { pageId: number }) => deps.notesService.restoreNote(pageId),
  );
}
