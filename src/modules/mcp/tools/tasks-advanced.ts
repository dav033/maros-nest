import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TASK_STATUSES } from '../../../entities/task.entity';
import { TASK_PARTY_KINDS } from '../../../entities/task-party.entity';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * El resto de lo que una tarea sabe hacer: observadores, partes implicadas,
 * dependencias, cronómetro, adjuntos, orden de subtareas y las operaciones en
 * lote.
 *
 * Aquí sí se borra, individualmente y en lote, con `confirm: true` obligatorio.
 * El grupo básico (`tasks.ts`) deja fuera el borrado a propósito porque archivar
 * es reversible y casi siempre es lo que se quiere; esto es la vía expresa para
 * cuando de verdad hay que destruir.
 *
 * No se expone `getMine()`: resuelve "mis tareas" contra el actor, y el actor del
 * MCP es un usuario de sistema que nunca tiene tareas. Devolvería siempre una
 * lista vacía. Para lo mismo pero útil: `search_tasks` con `assigneeUserId`.
 */

const taskId = z.number().int().positive();
const taskIds = z
  .array(taskId)
  .min(1)
  .max(500)
  .describe('Ids de las tareas afectadas');
const s3Key = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .describe('Clave del objeto en S3, de las que devuelven las tools de s3');

export function registerTaskAdvancedTools(server: McpServer, deps: McpToolDeps) {
  // ------------------------------------------------------------ observadores

  registerMcpTool(
    server,
    'list_task_watchers',
    'Los ids de usuario que siguen la tarea y reciben sus avisos.',
    { id: taskId },
    async ({ id }: { id: number }) => deps.tasksService.listWatchers(id),
  );

  registerMcpTool(
    server,
    'add_task_watcher',
    'Añade a alguien como observador: a partir de ahí recibe los avisos de la tarea.',
    { id: taskId, userId: z.number().int().positive() },
    async ({ id, userId }: { id: number; userId: number }) =>
      deps.tasksService.addWatcher(id, userId, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'remove_task_watcher',
    'Quita a alguien de los observadores de la tarea.',
    { id: taskId, userId: z.number().int().positive() },
    async ({ id, userId }: { id: number; userId: number }) =>
      deps.tasksService.removeWatcher(id, userId, await deps.mcpActor.taskActor()),
  );

  // ------------------------------------------------------- partes implicadas

  registerMcpTool(
    server,
    'list_task_parties',
    'Las empresas y contactos implicados en la tarea, con su papel.',
    { id: taskId },
    async ({ id }: { id: number }) => deps.tasksService.listParties(id),
  );

  registerMcpTool(
    server,
    'set_task_parties',
    'Reemplaza las partes implicadas por esta lista exacta. Una lista vacía las quita todas.',
    {
      id: taskId,
      parties: z.array(
        z.object({
          partyKind: z.enum(TASK_PARTY_KINDS),
          partyId: z.number().int().positive(),
          role: z.string().max(40).optional().describe('Su papel, p. ej. "subcontractor"'),
        }),
      ),
    },
    async ({ id, parties }: { id: number; parties: unknown[] }) =>
      deps.tasksService.setParties(id, { parties } as never, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'get_tasks_by_party',
    'Las tareas en las que participa una empresa o un contacto.',
    {
      partyKind: z.enum(TASK_PARTY_KINDS),
      partyId: z.number().int().positive(),
    },
    async ({
      partyKind,
      partyId,
    }: {
      partyKind: 'company' | 'contact';
      partyId: number;
    }) => deps.tasksService.getByParty(partyKind, partyId),
  );

  // ----------------------------------------------------------- dependencias

  registerMcpTool(
    server,
    'list_task_dependencies',
    'Los ids de las tareas de las que depende esta. Mientras alguna siga abierta, esta está bloqueada por ella.',
    { id: taskId },
    async ({ id }: { id: number }) => deps.taskDependencies.list(id),
  );

  registerMcpTool(
    server,
    'set_task_dependencies',
    'Reemplaza las dependencias por esta lista exacta. Una lista vacía las quita todas. El servicio rechaza los ciclos.',
    {
      id: taskId,
      dependsOnTaskIds: z.array(taskId).max(100),
    },
    async ({ id, dependsOnTaskIds }: { id: number; dependsOnTaskIds: number[] }) =>
      deps.taskDependencies.replace(id, dependsOnTaskIds),
  );

  // ------------------------------------------------------------- cronometro

  registerMcpTool(
    server,
    'start_task_timer',
    'Arranca el cronómetro de la tarea, para contar horas trabajadas.',
    { id: taskId },
    async ({ id }: { id: number }) =>
      deps.tasksService.startTimer(id, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'stop_task_timer',
    'Para el cronómetro y acumula el tiempo transcurrido en la tarea.',
    { id: taskId },
    async ({ id }: { id: number }) =>
      deps.tasksService.stopTimer(id, await deps.mcpActor.taskActor()),
  );

  // ---------------------------------------------------------------- adjuntos

  registerMcpTool(
    server,
    'add_task_attachments',
    'Adjunta archivos ya subidos a S3 a la tarea. El archivo se sube primero con las tools de s3; aquí solo se enlazan sus claves.',
    { id: taskId, keys: z.array(s3Key).min(1).max(50) },
    async ({ id, keys }: { id: number; keys: string[] }) =>
      deps.tasksService.addAttachments(id, keys, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'remove_task_attachment',
    'Quita un adjunto de la tarea.',
    { id: taskId, key: s3Key },
    async ({ id, key }: { id: number; key: string }) =>
      deps.tasksService.removeAttachment(id, key, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'reorder_task_attachments',
    'Fija el orden en que se muestran los adjuntos. La lista tiene que traer todas las claves.',
    { id: taskId, keys: z.array(s3Key).min(1).max(50) },
    async ({ id, keys }: { id: number; keys: string[] }) =>
      deps.tasksService.reorderAttachments(id, keys, await deps.mcpActor.taskActor()),
  );

  // -------------------------------------------------------------- subtareas

  registerMcpTool(
    server,
    'reorder_subtask',
    'Mueve una subtarea entre sus hermanas. beforeId y afterId dicen dónde cae.',
    {
      id: taskId,
      beforeId: taskId.nullable().optional(),
      afterId: taskId.nullable().optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.tasksService.reorderSubtask(id, dto as never, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'add_labels_to_task',
    'Suma etiquetas a la tarea sin quitar las que ya tenía. Para reemplazarlas por completo, set_task_labels.',
    { id: taskId, labelIds: z.array(z.number().int().positive()).min(1) },
    async ({ id, labelIds }: { id: number; labelIds: number[] }) =>
      deps.tasksService.addLabelsToTask(id, labelIds, await deps.mcpActor.taskActor()),
  );

  // ------------------------------------------------------------------- lote

  registerMcpTool(
    server,
    'bulk_set_task_assignee',
    'Asigna varias tareas a la misma persona de una vez, o las deja sin asignar con userId=null.',
    { taskIds, userId: z.number().int().positive().nullable() },
    async ({ taskIds: ids, userId }: { taskIds: number[]; userId: number | null }) =>
      deps.tasksService.bulkSetAssignee(ids, userId, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'bulk_set_task_status',
    'Mueve varias tareas al mismo estado. blockedReason es obligatorio si el destino es "blocked" y alguna de ellas no traía ya un motivo.',
    {
      taskIds,
      status: z.enum(TASK_STATUSES),
      blockedReason: z.string().max(500).optional(),
    },
    async ({
      taskIds: ids,
      status,
      blockedReason,
    }: {
      taskIds: number[];
      status: (typeof TASK_STATUSES)[number];
      blockedReason?: string;
    }) =>
      deps.tasksService.bulkSetStatus(
        ids,
        status,
        blockedReason,
        await deps.mcpActor.taskActor(),
      ),
  );

  registerMcpTool(
    server,
    'bulk_add_task_labels',
    'Suma las mismas etiquetas a varias tareas.',
    { taskIds, labelIds: z.array(z.number().int().positive()).min(1) },
    async ({ taskIds: ids, labelIds }: { taskIds: number[]; labelIds: number[] }) =>
      deps.tasksService.bulkAddLabels(ids, labelIds, await deps.mcpActor.taskActor()),
  );

  // ----------------------------------------------------------------- borrar

  registerMcpTool(
    server,
    'delete_task',
    'Borra una tarea con sus comentarios, adjuntos y subtareas. NO SE PUEDE DESHACER. Casi siempre lo que se quiere es archive_task, que es reversible. Pide confirm=true.',
    {
      id: taskId,
      confirm: z
        .literal(true)
        .describe('Debe ser exactamente true. Confirma un borrado irreversible.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.tasksService
        .delete(id, await deps.mcpActor.taskActor())
        .then(() => ({ id, deleted: true })),
  );

  registerMcpTool(
    server,
    'bulk_delete_tasks',
    'Borra varias tareas de una vez. NO SE PUEDE DESHACER y es la operación más destructiva del MCP: revisa la lista antes. Pide confirm=true.',
    {
      taskIds,
      confirm: z
        .literal(true)
        .describe('Debe ser exactamente true. Confirma un borrado irreversible en lote.'),
    },
    async ({ taskIds: ids }: { taskIds: number[]; confirm: true }) =>
      deps.tasksService.bulkDelete(ids, await deps.mcpActor.taskActor()),
  );
}
