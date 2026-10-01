import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Lo que quedaba suelto del backend sin ninguna tool: el catálogo de servicios
 * que ofrecen las empresas, las notificaciones, el pipeline genérico de archivos
 * y el generador de enlaces del reporte de visita de restauración.
 *
 * Son cuatro áreas pequeñas y sin relación entre ellas; están juntas porque cada
 * una no llega a justificar su propio archivo y separarlas daría cuatro ficheros
 * de treinta líneas.
 *
 * Las notificaciones son por persona, así que todas sus tools piden un `userId`
 * explícito. Firmarlas con el usuario de sistema del MCP no serviría de nada: no
 * tiene notificaciones y nunca las tendrá.
 */

const userId = z
  .number()
  .int()
  .positive()
  .describe('Usuario dueño de las notificaciones; sale de list_users');

export function registerPlatformTools(server: McpServer, deps: McpToolDeps) {
  // ------------------------------------------- catalogo de servicios

  registerMcpTool(
    server,
    'list_company_services',
    'El catálogo de servicios que se pueden asignar a una empresa, con su color.',
    {},
    async () => deps.companyServicesService.findAll(),
  );

  registerMcpTool(
    server,
    'get_company_service',
    'Un servicio del catálogo por id.',
    { id: z.number().int().positive() },
    async ({ id }: { id: number }) => deps.companyServicesService.findById(id),
  );

  registerMcpTool(
    server,
    'create_company_service',
    'Añade un servicio al catálogo.',
    {
      name: z.string().trim().min(1).max(100),
      color: z.string().max(40).optional(),
    },
    async (dto: { name: string; color?: string }) =>
      deps.companyServicesService.create(dto as never),
  );

  registerMcpTool(
    server,
    'update_company_service',
    'Cambia el nombre o el color de un servicio del catálogo.',
    {
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(100).optional(),
      color: z.string().max(40).optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.companyServicesService.update(id, dto as never),
  );

  registerMcpTool(
    server,
    'delete_company_service',
    'Borra un servicio del catálogo. Pide confirm=true porque no se puede deshacer.',
    {
      id: z.number().int().positive(),
      confirm: z.literal(true).describe('Debe ser exactamente true.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.companyServicesService.delete(id).then(() => ({ id, deleted: true })),
  );

  // ---------------------------------------------------- notificaciones

  registerMcpTool(
    server,
    'list_user_notifications',
    'Las notificaciones de una persona. Útil para saber qué tiene pendiente sin pedírselo.',
    {
      userId,
      unreadOnly: z.boolean().optional().describe('Solo las no leídas'),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({
      userId: id,
      unreadOnly,
      limit,
    }: {
      userId: number;
      unreadOnly?: boolean;
      limit?: number;
    }) => deps.notificationsService.list(id, unreadOnly ?? false, limit),
  );

  registerMcpTool(
    server,
    'get_user_unread_notification_count',
    'Cuántas notificaciones sin leer tiene una persona.',
    { userId },
    async ({ userId: id }: { userId: number }) =>
      deps.notificationsService.unreadCount(id).then((count) => ({ userId: id, count })),
  );

  registerMcpTool(
    server,
    'mark_notification_read',
    'Marca como leída una notificación de esa persona.',
    { userId, notificationId: z.number().int().positive() },
    async ({
      userId: id,
      notificationId,
    }: {
      userId: number;
      notificationId: number;
    }) =>
      deps.notificationsService
        .markRead(notificationId, id)
        .then(() => ({ notificationId, userId: id, read: true })),
  );

  registerMcpTool(
    server,
    'mark_all_notifications_read',
    'Marca como leídas todas las notificaciones de una persona. Vacía su campana de golpe, así que conviene preguntarle antes.',
    { userId },
    async ({ userId: id }: { userId: number }) =>
      deps.notificationsService.markAllRead(id).then(() => ({ userId: id, allRead: true })),
  );

  // --------------------------------------------------- archivos gestionados

  registerMcpTool(
    server,
    'create_file_upload_intent',
    'Reserva un hueco para subir un archivo y devuelve la URL firmada a la que hacerle PUT. Luego hay que llamar a complete_file_upload para darlo por bueno.',
    {
      fileName: z.string().trim().min(1).max(255),
      contentType: z.string().trim().min(1).max(120),
      sizeBytes: z.number().int().min(1),
    },
    async (dto: Record<string, unknown>) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.managedFilesService.createIntent(dto as never, actor);
    },
  );

  registerMcpTool(
    server,
    'complete_file_upload',
    'Confirma que el archivo ya está en su sitio y lo marca como disponible.',
    {
      id: z.number().int().positive(),
      sizeBytes: z.number().int().min(1).optional(),
      checksum: z.string().max(255).optional(),
    },
    async ({ id, ...dto }: { id: number }) =>
      deps.managedFilesService.complete(id, dto as never),
  );

  registerMcpTool(
    server,
    'retry_file_upload',
    'Devuelve una URL de subida nueva para un archivo cuya subida se quedó a medias.',
    { id: z.number().int().positive() },
    async ({ id }: { id: number }) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.managedFilesService.retry(id, actor);
    },
  );

  registerMcpTool(
    server,
    'get_file_download_url',
    'URL firmada para descargar un archivo gestionado.',
    { id: z.number().int().positive() },
    async ({ id }: { id: number }) => deps.managedFilesService.getDownloadUrl(id),
  );

  registerMcpTool(
    server,
    'delete_managed_file',
    'Borra un archivo gestionado y su objeto en S3. Pide confirm=true porque no se puede deshacer.',
    {
      id: z.number().int().positive(),
      confirm: z.literal(true).describe('Debe ser exactamente true.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.managedFilesService.remove(id).then(() => ({ id, deleted: true })),
  );

  // ------------------------------------------- reporte de visita

  registerMcpTool(
    server,
    'generate_restoration_visit_url',
    'Genera el enlace del reporte de visita de restauración con los datos ya dentro. Los datos van codificados en la propia URL, no se guardan en la base.',
    { data: z.record(z.string(), z.unknown()).describe('Campos del reporte de visita') },
    async ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(
        deps.restorationVisitService.generateRestorationVisitUrl(data as never),
      ),
  );

  registerMcpTool(
    server,
    'read_restoration_visit_url',
    'Lee de vuelta los datos de un enlace de visita de restauración, a partir de su parte en base64.',
    { base64Data: z.string().min(1).describe('El trozo base64 de la URL') },
    async ({ base64Data }: { base64Data: string }) =>
      deps.restorationVisitService.getRestorationVisitFromBase64(base64Data),
  );
}
