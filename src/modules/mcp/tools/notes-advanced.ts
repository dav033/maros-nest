import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NOTE_ENTITY_KINDS } from '../../notes/note-management/dto/create-note.dto';
import { NOTE_TAG_COLORS } from '../../notes/note-management/dto/create-tag.dto';
import { NOTE_VISIBILITIES } from '../../notes/note-management/dto/set-visibility.dto';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Lo que faltaba de las notas: reemplazar el contenido, vincular a una entidad,
 * etiquetar, visibilidad, la papelera, el borrado definitivo y el CRUD de
 * etiquetas.
 *
 * Lo que NO se expone, y por qué
 * ------------------------------
 * Favoritos y "compartidos conmigo" son por persona, y las tools del MCP no
 * llevan actor. `setFavorite` sin actor entra en un `if (actor)` y **no hace
 * nada, sin error**: una tool así devolvería éxito sin haber marcado nada. Eso es
 * peor que no tenerla.
 *
 * Tampoco se exponen los compartidos ni los enlaces públicos
 * (`/shares`, `/links`, `/access`). Son control de acceso entre personas
 * concretas, y un agente sin identidad concediendo permisos a terceros es una
 * decisión que no debería tomar una llamada de herramienta.
 */

const noteId = z.number().int().positive();

export function registerNoteAdvancedTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'notes_list_trash',
    'Las notas en la papelera, que salieron del árbol pero todavía se pueden restaurar.',
    {},
    async () => deps.notesService.getTrash(),
  );

  registerMcpTool(
    server,
    'notes_replace_content',
    'Reemplaza el contenido entero de una nota. Para añadir al final sin tocar lo de antes, notes_append_to_page.',
    {
      id: noteId,
      content: z
        .record(z.string(), z.unknown())
        .describe('Documento TipTap completo: { "type": "doc", "content": [...] }'),
      expectedUpdatedAt: z
        .string()
        .optional()
        .describe('updatedAt que leíste, para detectar que alguien editó en medio'),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.notesService.updateNoteContent(id, dto as never),
  );

  registerMcpTool(
    server,
    'notes_set_entity',
    'Vincula la nota a un lead, proyecto, contacto o empresa. Los dos campos en null la desvinculan.',
    {
      id: noteId,
      entityKind: z.enum(NOTE_ENTITY_KINDS).nullable(),
      entityId: z.number().int().positive().nullable(),
    },
    async ({
      id,
      entityKind,
      entityId,
    }: {
      id: number;
      entityKind: 'lead' | 'project' | 'contact' | 'company' | null;
      entityId: number | null;
    }) => deps.notesService.setEntityLink(id, { entityKind, entityId } as never),
  );

  registerMcpTool(
    server,
    'notes_set_tags',
    'Reemplaza las etiquetas de la nota por esta lista exacta. Una lista vacía las quita todas.',
    { id: noteId, tagIds: z.array(z.number().int().positive()) },
    async ({ id, tagIds }: { id: number; tagIds: number[] }) =>
      deps.notesService.setTags(id, tagIds),
  );

  registerMcpTool(
    server,
    'notes_set_visibility',
    'Cambia quién ve la nota: "private" solo su dueño, "team" todo el personal.',
    { id: noteId, visibility: z.enum(NOTE_VISIBILITIES) },
    async ({ id, visibility }: { id: number; visibility: 'private' | 'team' }) =>
      deps.notesService.setVisibility(id, { visibility } as never),
  );

  registerMcpTool(
    server,
    'notes_purge_page',
    'Borra definitivamente una nota de la papelera. NO SE PUEDE DESHACER; para sacarla del árbol sin perderla, notes_trash_page. Pide confirm=true.',
    {
      id: noteId,
      confirm: z
        .literal(true)
        .describe('Debe ser exactamente true. Confirma un borrado irreversible.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.notesService.purgeNote(id).then(() => ({ id, purged: true })),
  );

  // -------------------------------------------------- etiquetas de notas

  registerMcpTool(
    server,
    'notes_create_tag',
    'Crea una etiqueta de notas. El tagId de notes_set_tags sale de notes_list_tags.',
    {
      name: z.string().trim().min(1).max(50),
      color: z.enum(NOTE_TAG_COLORS).optional().describe('"neutral" si se omite'),
    },
    async (dto: { name: string; color?: string }) =>
      deps.noteTagsService.createTag(dto as never),
  );

  registerMcpTool(
    server,
    'notes_update_tag',
    'Cambia el nombre o el color de una etiqueta de notas. Afecta a todas las notas que la llevan.',
    {
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(50).optional(),
      color: z.enum(NOTE_TAG_COLORS).optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.noteTagsService.updateTag(id, dto as never),
  );

  registerMcpTool(
    server,
    'notes_delete_tag',
    'Borra una etiqueta de notas y la quita de todas las notas que la llevaban. Pide confirm=true.',
    {
      id: z.number().int().positive(),
      confirm: z.literal(true).describe('Debe ser exactamente true.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.noteTagsService.deleteTag(id).then(() => ({ id, deleted: true })),
  );
}
