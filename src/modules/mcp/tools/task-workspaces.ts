import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TASK_KINDS, TASK_PRIORITIES } from '../../../entities/task.entity';
import {
  TASK_WORKSPACE_ENTITY_KINDS,
  TASK_WORKSPACE_RELATIONSHIPS,
} from '../../../entities/task-workspace-link.entity';
import { TASK_WORKSPACE_TYPES } from '../../../entities/task-workspace.entity';
import { TASK_LABEL_COLORS } from '../../tasks/task-management/dto/create-label.dto';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Lo que organiza las tareas: workspaces, sus carpetas, las etiquetas y las
 * plantillas.
 *
 * Esto existe porque sin él las tools de tareas estaban cojas: `create_task`
 * acepta `workspaceId` y `folderId`, y `set_task_labels` pide ids de etiqueta,
 * pero no había ninguna forma de averiguar cuáles existen. Un parámetro que no
 * se puede descubrir es un parámetro que no se usa.
 *
 * Igual que en el resto del MCP, los esquemas zod son la única validación y las
 * escrituras van firmadas por el usuario de sistema.
 */

const workspaceId = z.number().int().positive();
const folderId = z.number().int().positive();

const workspaceLink = z.object({
  entityKind: z.enum(TASK_WORKSPACE_ENTITY_KINDS),
  entityId: z.number().int().positive(),
  relationship: z.enum(TASK_WORKSPACE_RELATIONSHIPS).optional(),
});

export function registerTaskWorkspaceTools(server: McpServer, deps: McpToolDeps) {
  // ------------------------------------------------------------- workspaces

  registerMcpTool(
    server,
    'list_task_workspaces',
    'Los workspaces de tareas, con sus vínculos a leads, proyectos, contactos o empresas. Los archivados quedan fuera salvo que se pidan.',
    {
      query: z.string().max(160).optional().describe('Texto sobre el título'),
      includeArchived: z.boolean().optional(),
      entityKind: z.enum(TASK_WORKSPACE_ENTITY_KINDS).optional(),
      entityId: z.number().int().positive().optional(),
    },
    async (filters: Record<string, unknown>) =>
      deps.taskWorkspacesService.list(filters as never),
  );

  registerMcpTool(
    server,
    'get_task_workspace',
    'Un workspace por id, con sus carpetas y vínculos.',
    { id: workspaceId },
    async ({ id }: { id: number }) => deps.taskWorkspacesService.get(id),
  );

  registerMcpTool(
    server,
    'get_task_workspace_options',
    'La lista corta de workspaces (id, título, si está archivado) para elegir uno. Es de donde sale el workspaceId de create_task.',
    {},
    async () => deps.taskWorkspaceAssignment.listOptions(),
  );

  registerMcpTool(
    server,
    'create_task_workspace',
    'Crea un workspace. Los vínculos lo atan a leads, proyectos, contactos o empresas; "primary" marca el principal.',
    {
      title: z.string().trim().min(1).max(160),
      description: z.record(z.string(), z.unknown()).optional().describe('Documento TipTap'),
      workspaceType: z.enum(TASK_WORKSPACE_TYPES).optional(),
      links: z.array(workspaceLink).optional(),
    },
    async (dto: Record<string, unknown>) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.taskWorkspacesService.create(dto as never, actor);
    },
  );

  registerMcpTool(
    server,
    'update_task_workspace',
    'Cambia el título o la descripción de un workspace.',
    {
      id: workspaceId,
      title: z.string().trim().min(1).max(160).optional(),
      description: z.record(z.string(), z.unknown()).nullable().optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.taskWorkspacesService.update(id, dto as never),
  );

  registerMcpTool(
    server,
    'archive_task_workspace',
    'Archiva un workspace: deja de aparecer en las listas, pero no se borra. Reversible con restore_task_workspace.',
    { id: workspaceId },
    async ({ id }: { id: number }) =>
      deps.taskWorkspacesService.archive(id).then(() => ({ id, archived: true })),
  );

  registerMcpTool(
    server,
    'restore_task_workspace',
    'Devuelve a las listas un workspace archivado.',
    { id: workspaceId },
    async ({ id }: { id: number }) => deps.taskWorkspacesService.restore(id),
  );

  registerMcpTool(
    server,
    'add_task_workspace_links',
    'Ata un workspace a más entidades del CRM.',
    { id: workspaceId, links: z.array(workspaceLink).min(1) },
    async ({ id, links }: { id: number; links: unknown[] }) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.taskWorkspacesService.addLinks(id, { links } as never, actor);
    },
  );

  registerMcpTool(
    server,
    'remove_task_workspace_link',
    'Quita un vínculo entre un workspace y una entidad del CRM. No borra ni el workspace ni la entidad.',
    {
      id: workspaceId,
      entityKind: z.enum(TASK_WORKSPACE_ENTITY_KINDS),
      entityId: z.number().int().positive(),
    },
    async ({
      id,
      entityKind,
      entityId,
    }: {
      id: number;
      entityKind: string;
      entityId: number;
    }) =>
      deps.taskWorkspacesService
        .removeLink(id, entityKind, entityId)
        .then(() => ({ id, entityKind, entityId, removed: true })),
  );

  registerMcpTool(
    server,
    'move_task_to_folder',
    'Mueve una tarea a otra carpeta del workspace. folderId en null la deja en la raíz.',
    {
      workspaceId,
      taskId: z.number().int().positive(),
      folderId: folderId.nullable().optional(),
    },
    async (args: { workspaceId: number; taskId: number; folderId?: number | null }) =>
      deps.taskWorkspacesService.moveTask(args.workspaceId, args.taskId, args.folderId),
  );

  // ---------------------------------------------------------------- carpetas

  registerMcpTool(
    server,
    'list_task_workspace_folders',
    'Las carpetas de un workspace, con su jerarquía y orden.',
    { workspaceId },
    async ({ workspaceId: id }: { workspaceId: number }) =>
      deps.taskWorkspaceFolders.list(id),
  );

  registerMcpTool(
    server,
    'create_task_workspace_folder',
    'Crea una carpeta dentro de un workspace. parentFolderId la anida.',
    {
      workspaceId,
      title: z.string().trim().min(1).max(160),
      parentFolderId: folderId.optional(),
      position: z.number().int().min(0).optional(),
    },
    async ({ workspaceId: id, ...dto }: { workspaceId: number }) =>
      deps.taskWorkspaceFolders.create(id, dto as never),
  );

  registerMcpTool(
    server,
    'update_task_workspace_folder',
    'Renombra una carpeta, la mueve de padre o cambia su posición. parentFolderId en null la saca a la raíz.',
    {
      workspaceId,
      folderId,
      title: z.string().trim().min(1).max(160).optional(),
      parentFolderId: folderId.nullable().optional(),
      position: z.number().int().min(0).optional(),
    },
    async ({
      workspaceId: wsId,
      folderId: fId,
      ...dto
    }: {
      workspaceId: number;
      folderId: number;
    }) => deps.taskWorkspaceFolders.update(wsId, fId, dto as never),
  );

  registerMcpTool(
    server,
    'delete_task_workspace_folder',
    'Borra una carpeta. destinationFolderId dice dónde van sus tareas; sin él quedan en la raíz del workspace. Pide confirm=true porque no se puede deshacer.',
    {
      workspaceId,
      folderId,
      destinationFolderId: folderId
        .nullable()
        .optional()
        .describe('Carpeta a la que se mudan las tareas que había dentro'),
      confirm: z.literal(true).describe('Debe ser exactamente true.'),
    },
    async ({
      workspaceId: wsId,
      folderId: fId,
      destinationFolderId,
    }: {
      workspaceId: number;
      folderId: number;
      destinationFolderId?: number | null;
      confirm: true;
    }) =>
      deps.taskWorkspaceFolders
        .remove(wsId, fId, destinationFolderId)
        .then(() => ({ workspaceId: wsId, folderId: fId, deleted: true })),
  );

  // -------------------------------------------------------------- etiquetas

  registerMcpTool(
    server,
    'list_task_labels',
    'Todas las etiquetas de tareas con su color. Es de donde salen los labelIds de set_task_labels y create_task.',
    {},
    async () => deps.taskLabelsService.listLabels(),
  );

  registerMcpTool(
    server,
    'create_task_label',
    'Crea una etiqueta de tareas.',
    {
      name: z.string().trim().min(1).max(50),
      color: z.enum(TASK_LABEL_COLORS).optional().describe('"neutral" si se omite'),
    },
    async (dto: { name: string; color?: string }) =>
      deps.taskLabelsService.createLabel(dto as never),
  );

  registerMcpTool(
    server,
    'update_task_label',
    'Cambia el nombre o el color de una etiqueta. Afecta a todas las tareas que la llevan.',
    {
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(50).optional(),
      color: z.enum(TASK_LABEL_COLORS).optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.taskLabelsService.updateLabel(id, dto as never),
  );

  registerMcpTool(
    server,
    'delete_task_label',
    'Borra una etiqueta y la quita de todas las tareas que la llevaban. Pide confirm=true porque no se puede deshacer.',
    {
      id: z.number().int().positive(),
      confirm: z.literal(true).describe('Debe ser exactamente true.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.taskLabelsService.deleteLabel(id).then(() => ({ id, deleted: true })),
  );

  // -------------------------------------------------------------- plantillas

  registerMcpTool(
    server,
    'list_task_templates',
    'Las plantillas de tareas con sus items. Cada item lleva un offsetDays: los días desde la fecha de inicio en que vence.',
    {},
    async () => deps.taskTemplatesService.list(),
  );

  registerMcpTool(
    server,
    'create_task_template',
    'Crea una plantilla de tareas reutilizable.',
    {
      name: z.string().trim().min(1).max(120),
      projectType: z.string().max(80).optional(),
      items: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(255),
            kind: z.enum(TASK_KINDS).optional(),
            priority: z.enum(TASK_PRIORITIES).optional(),
            offsetDays: z
              .number()
              .int()
              .min(0)
              .optional()
              .describe('Días desde el inicio en que vence esta tarea'),
          }),
        )
        .min(1),
    },
    async (dto: Record<string, unknown>) =>
      deps.taskTemplatesService.create(dto as never),
  );

  registerMcpTool(
    server,
    'apply_task_template',
    'Aplica una plantilla a un lead: crea de golpe todas sus tareas, con las fechas calculadas desde startDate. Devuelve las tareas creadas.',
    {
      templateId: z.number().int().positive(),
      leadId: z.number().int().positive(),
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Base del cálculo de offsetDays; hoy si se omite'),
    },
    async ({
      templateId,
      leadId,
      startDate,
    }: {
      templateId: number;
      leadId: number;
      startDate?: string;
    }) =>
      deps.taskTemplatesService.apply(
        templateId,
        leadId,
        startDate,
        await deps.mcpActor.taskActor(),
      ),
  );
}
