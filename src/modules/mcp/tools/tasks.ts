import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../../entities/task.entity';
import { TASK_ENTITY_KINDS } from '../../tasks/task-management/dto/create-task.dto';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Tareas: el tablero, su contenido y lo que se puede hacer sobre una tarea.
 *
 * Igual que en los document scans, acá no corre el ValidationPipe de Nest, así
 * que los esquemas zod son la única validación antes del servicio y replican las
 * reglas de los DTO.
 *
 * Toda escritura va firmada por el usuario de sistema del MCP
 * (`McpActorService`), no por una persona: el token del MCP no identifica a
 * nadie, y un reporter o un log de actividad necesitan un id real. Lo que hizo
 * el agente se distingue en el log por ese autor.
 *
 * Borrar no está acá, ni individual ni en lote: una tarea se archiva
 * (`archive_task`), que es reversible con `restore_task`.
 */

const taskId = z.number().int().positive();
// Los DTO usan @IsDateString(), que acepta ISO 8601 completo o solo la fecha.
// Se valida con regex en vez de z.string().date(), que no existe en esta version
// de zod y hacia fallar la compilacion en silencio hasta el typecheck.
const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    'Debe ser YYYY-MM-DD o una fecha-hora ISO 8601',
  );
// zod 4 exige esquema de clave y de valor en z.record; con uno solo no compila.
const tipTapDoc = z
  .record(z.string(), z.unknown())
  .describe('Documento TipTap en JSON: { "type": "doc", "content": [...] }');

export function registerTaskTools(server: McpServer, deps: McpToolDeps) {
  // ---------------------------------------------------------------- lectura

  registerMcpTool(
    server,
    'get_task_board',
    'El tablero completo: las tareas agrupadas por columna de estado, más el total de hechas. Acepta los mismos filtros que la búsqueda.',
    {
      status: z.array(z.enum(TASK_STATUSES)).optional(),
      assigneeUserId: z.array(z.number().int()).optional(),
      kind: z.array(z.enum(TASK_KINDS)).optional(),
      priority: z.array(z.enum(TASK_PRIORITIES)).optional(),
      labelId: z.array(z.number().int()).optional(),
      q: z.string().optional().describe('Texto libre sobre título y descripción'),
      workspaceId: z.number().int().optional(),
    },
    async (filters: Record<string, unknown>) => deps.tasksService.getBoard(filters),
  );

  registerMcpTool(
    server,
    'search_tasks',
    'Busca tareas con filtros y paginación por cursor. Devuelve items, totalCount y nextCursor.',
    {
      q: z.string().optional(),
      status: z.array(z.enum(TASK_STATUSES)).optional(),
      assigneeUserId: z.array(z.number().int()).optional(),
      kind: z.array(z.enum(TASK_KINDS)).optional(),
      priority: z.array(z.enum(TASK_PRIORITIES)).optional(),
      labelId: z.array(z.number().int()).optional(),
      entityKind: z.enum(TASK_ENTITY_KINDS).optional(),
      entityId: z.number().int().optional(),
      dueBefore: isoDate.optional().describe('Vencen antes de esta fecha'),
      dueOn: isoDate.optional().describe('Vencen exactamente este día'),
      includeSubtasks: z
        .boolean()
        .optional()
        .describe('Por defecto false: solo tareas de primer nivel'),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional().describe('nextCursor de la llamada anterior'),
    },
    async (filters: Record<string, unknown>) => deps.tasksService.findAll(filters),
  );

  registerMcpTool(
    server,
    'get_task',
    'Una tarea por id, con sus relaciones.',
    { id: taskId },
    async ({ id }: { id: number }) => deps.tasksService.getById(id),
  );

  registerMcpTool(
    server,
    'get_tasks_by_entity',
    'Las tareas vinculadas a un lead, proyecto, contacto o empresa.',
    {
      entityKind: z.enum(TASK_ENTITY_KINDS),
      entityId: z.number().int().positive(),
    },
    async ({
      entityKind,
      entityId,
    }: {
      entityKind: 'lead' | 'project' | 'contact' | 'company';
      entityId: number;
    }) => deps.tasksService.getByEntity(entityKind, entityId),
  );

  registerMcpTool(
    server,
    'get_task_schedule',
    'Las tareas con fecha dentro de un rango, para ver la agenda.',
    {
      from: isoDate.optional(),
      to: isoDate.optional(),
      assigneeUserId: z.array(z.number().int()).optional(),
    },
    async (filters: Record<string, unknown>) =>
      deps.tasksService.getSchedule(filters),
  );

  registerMcpTool(
    server,
    'get_archived_tasks',
    'Las tareas archivadas, que no aparecen en el tablero.',
    {},
    async () => deps.tasksService.findArchived(),
  );

  registerMcpTool(
    server,
    'list_task_comments',
    'Los comentarios de una tarea, del más viejo al más nuevo.',
    { taskId },
    async ({ taskId: id }: { taskId: number }) => deps.taskCommentsService.list(id),
  );

  // --------------------------------------------------------------- escritura

  registerMcpTool(
    server,
    'create_task',
    'Crea una tarea. Si no se da reporter, queda el usuario de sistema del MCP. `parentId` la convierte en subtarea, y el padre no puede ser a su vez una subtarea.',
    {
      title: z.string().max(255).optional().describe('"Untitled task" si se omite'),
      description: tipTapDoc.optional(),
      kind: z.enum(TASK_KINDS).optional().describe('"general" si se omite'),
      priority: z.enum(TASK_PRIORITIES).optional().describe('"normal" si se omite'),
      parentId: z.number().int().positive().optional(),
      assigneeUserId: z.number().int().positive().optional(),
      reporterId: z.number().int().positive().optional(),
      entityKind: z.enum(TASK_ENTITY_KINDS).optional(),
      entityId: z.number().int().positive().optional(),
      startDate: isoDate.optional(),
      dueDate: isoDate.optional(),
      recurrenceRule: z
        .string()
        .max(120)
        .optional()
        .describe('RRULE simple, p. ej. FREQ=WEEKLY;INTERVAL=1'),
      recurrenceUntil: isoDate.optional(),
      estimatedHours: z.number().min(0).optional(),
      labelIds: z.array(z.number().int()).optional(),
      workspaceId: z.number().int().positive().optional(),
      folderId: z.number().int().positive().optional(),
    },
    async (dto: Record<string, unknown>) =>
      deps.tasksService.create(dto, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'update_task',
    'Cambia campos de una tarea. Solo se tocan los presentes en la llamada; null borra el valor. Para mover de columna usa move_task.',
    {
      id: taskId,
      title: z.string().max(255).optional(),
      description: tipTapDoc.optional(),
      kind: z.enum(TASK_KINDS).optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
      reporterId: z.number().int().positive().nullable().optional(),
      startDate: isoDate.nullable().optional(),
      dueDate: isoDate.nullable().optional(),
      blockedReason: z.string().max(500).nullable().optional(),
      recurrenceRule: z.string().max(120).nullable().optional(),
      recurrenceUntil: isoDate.nullable().optional(),
      estimatedHours: z.number().min(0).nullable().optional(),
      expectedUpdatedAt: z
        .string()
        .optional()
        .describe('updatedAt que leíste, para detectar una edición ajena en medio'),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.tasksService.update(id, dto, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'move_task',
    'Mueve la tarea a otra columna del tablero. `blocked` exige blockedReason la primera vez, y `cancelled` exige cancelledReason. beforeId/afterId colocan la tarea entre sus hermanas.',
    {
      id: taskId,
      status: z.enum(TASK_STATUSES),
      beforeId: z.number().int().nullable().optional(),
      afterId: z.number().int().nullable().optional(),
      blockedReason: z.string().max(500).optional(),
      cancelledReason: z.string().max(500).optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.tasksService.move(id, dto as never, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'set_task_assignee',
    'Asigna la tarea a un usuario, o la deja sin asignar con userId=null.',
    { id: taskId, userId: z.number().int().positive().nullable() },
    async ({ id, userId }: { id: number; userId: number | null }) =>
      deps.tasksService.setAssignee(id, { userId }, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'set_task_labels',
    'Reemplaza las etiquetas de la tarea por esta lista exacta. Una lista vacía las quita todas.',
    { id: taskId, labelIds: z.array(z.number().int()) },
    async ({ id, labelIds }: { id: number; labelIds: number[] }) =>
      deps.tasksService.setLabels(id, { labelIds }, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'set_task_entity',
    'Vincula la tarea a un lead, proyecto, contacto o empresa. Los dos campos en null la desvinculan.',
    {
      id: taskId,
      entityKind: z.enum(TASK_ENTITY_KINDS).nullable(),
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
    }) =>
      deps.tasksService.setEntityLink(
        id,
        { entityKind, entityId },
        await deps.mcpActor.taskActor(),
      ),
  );

  registerMcpTool(
    server,
    'schedule_task',
    'Fija fechas y responsable en una sola operación, como al arrastrar en la agenda.',
    {
      id: taskId,
      startDate: isoDate.nullable().optional(),
      dueDate: isoDate.nullable().optional(),
      assigneeUserId: z.number().int().positive().nullable().optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.tasksService.schedule(id, dto, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'comment_on_task',
    'Añade un comentario a la tarea, firmado por el usuario de sistema del MCP. El cuerpo es un documento TipTap.',
    { taskId, body: tipTapDoc },
    async ({
      taskId: id,
      body,
    }: {
      taskId: number;
      body: Record<string, unknown>;
    }) =>
      deps.taskCommentsService.create(id, { body }, await deps.mcpActor.taskActor()),
  );

  registerMcpTool(
    server,
    'archive_task',
    'Archiva la tarea: sale del tablero pero no se borra. Reversible con restore_task.',
    { id: taskId },
    async ({ id }: { id: number }) =>
      deps.tasksService
        .archive(id, await deps.mcpActor.taskActor())
        .then(() => ({ id, archived: true })),
  );

  registerMcpTool(
    server,
    'restore_task',
    'Devuelve al tablero una tarea archivada.',
    { id: taskId },
    async ({ id }: { id: number }) =>
      deps.tasksService.restore(id, await deps.mcpActor.taskActor()),
  );
}
