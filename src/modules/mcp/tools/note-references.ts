import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  NOTE_REFERENCE_KINDS,
  NOTE_REFERENCE_ORIGINS,
} from '../../../entities/note-reference.entity';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * El grafo de las notas: a qué apunta una nota y qué notas apuntan a algo.
 *
 * Por qué importa para un agente: la pregunta inversa ("¿qué notas hablan de este lead?")
 * no se puede responder con `notes_search`, porque el texto de un chip no está en el
 * documento como texto — es un nodo con un id. Sin estas tools, un agente que lee una nota
 * ve "Acme roof" y no tiene forma de saber que eso es el lead 42.
 *
 * Lo que NO se expone, y por qué
 * ------------------------------
 * No hay tool para crear menciones inline. Una mención vive dentro del documento, y la
 * forma de escribirla es `notes_replace_content` / `notes_append_to_page` con un nodo
 * `entityMention`; el índice se reconstruye solo en cada guardado. Una tool aparte que
 * insertara filas sueltas crearía referencias que el siguiente guardado borraría.
 */

const pageId = z.number().int().positive();
const referenceKind = z.enum(NOTE_REFERENCE_KINDS);
const targetId = z.number().int().positive();

export function registerNoteReferenceTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'notes_list_references',
    'A qué apunta una nota: los registros fijados en su cabecera (origin "relation") y los mencionados con @ en el cuerpo (origin "inline"). Los nombres vienen resueltos en vivo; exists:false significa que el registro ya no está y el label es el que tenía.',
    { id: pageId },
    async ({ id }: { id: number }) => deps.noteReferencesService.listForPage(id),
  );

  registerMcpTool(
    server,
    'notes_list_backlinks',
    'Las notas que enlazan a esta nota, con las líneas desde las que la enlazan. Es la pregunta inversa de notes_list_references.',
    { id: pageId },
    async ({ id }: { id: number }) => deps.noteReferencesService.listBacklinks(id),
  );

  registerMcpTool(
    server,
    'notes_list_notes_referencing',
    'Las notas que apuntan a un registro del CRM (lead, proyecto, contacto, empresa, tarea, persona u otra nota). Con origins:["inline"] solo las que lo mencionan en el cuerpo; con ["relation"] solo las fijadas a él; omitido, las dos.',
    {
      kind: referenceKind,
      targetId,
      origins: z.array(z.enum(NOTE_REFERENCE_ORIGINS)).optional(),
    },
    async ({
      kind,
      targetId: target,
      origins,
    }: {
      kind: string;
      targetId: number;
      origins?: string[];
    }) =>
      deps.noteReferencesService.listNotesReferencing(
        kind,
        target,
        undefined,
        (origins ?? []) as never,
      ),
  );

  registerMcpTool(
    server,
    'notes_search_reference_targets',
    'Busca registros que una nota puede referenciar, en todo el CRM a la vez. Devuelve kind + id, que es lo que hace falta para fijar una relación o para escribir un nodo entityMention en el contenido. Con q vacío devuelve los más recientes de cada tipo.',
    {
      q: z.string().max(200).optional(),
      kinds: z.array(referenceKind).optional().describe('Omitido: busca en todos los tipos'),
      perKind: z.number().int().min(1).max(25).optional().describe('Máximo por tipo, por defecto 5'),
    },
    async ({ q, kinds, perKind }: { q?: string; kinds?: string[]; perKind?: number }) =>
      deps.noteReferencesService.search(q ?? '', kinds ?? [], perKind ?? 5),
  );

  registerMcpTool(
    server,
    'notes_add_relation',
    'Fija un registro a la cabecera de una nota. Es lo que hace que la nota salga en el panel de Notes de ese registro. Idempotente: fijar dos veces el mismo registro es una sola relación.',
    { id: pageId, kind: referenceKind, targetId },
    async ({ id, kind, targetId: target }: { id: number; kind: string; targetId: number }) =>
      deps.noteReferencesService.addRelation(id, kind, target),
  );

  registerMcpTool(
    server,
    'notes_remove_relation',
    'Quita un registro fijado a una nota. No toca las menciones del cuerpo: esas se quitan editando el documento.',
    { id: pageId, kind: referenceKind, targetId },
    async ({ id, kind, targetId: target }: { id: number; kind: string; targetId: number }) =>
      deps.noteReferencesService.removeRelation(id, kind, target),
  );
}
