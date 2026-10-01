import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Reuniones de Google Calendar y enlaces de Meet.
 *
 * Único grupo del MCP que actúa **como una persona** en vez de como el usuario de
 * sistema, y no por comodidad: la conexión con Google es por usuario
 * (`google_calendar_connections.user_id`) y el usuario de sistema no puede
 * autorizarla nunca, porque no puede iniciar sesión. O estas tools actúan como
 * alguien con conexión propia, o fallan siempre.
 *
 * De ahí que el `userId` sea un parámetro obligatorio y explícito de cada tool, y
 * no un valor por defecto: quien llama tiene que decir en nombre de quién está
 * actuando. La reunión aparece en el calendario de esa persona y los invitados
 * reciben el correo de su parte. La suplantación vive en un solo sitio,
 * `McpActorService.userAs`, que además rechaza las cuentas desactivadas.
 *
 * El flujo de OAuth (`/connect`, `/callback`) no se expone: son redirecciones de
 * navegador. Si `get_google_calendar_connection` dice que esa persona no está
 * conectada, tiene que conectarse ella desde la interfaz.
 */

const userId = z
  .number()
  .int()
  .positive()
  .describe(
    'En nombre de quién se actúa. La reunión queda en SU calendario de Google y los invitados reciben el correo de su parte. Sale de list_users.',
  );

const meetingId = z.number().int().positive();

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    'Debe ser una fecha-hora ISO 8601 con zona, p. ej. 2026-11-02T15:00:00-05:00',
  );

const timeZone = z
  .string()
  .max(100)
  .describe('Zona IANA, p. ej. America/New_York. Una inválida hace fallar la llamada');

const attendees = z
  .array(z.string().email())
  .max(100)
  .describe('Correos de los invitados; Google les manda la invitación');

export function registerGoogleCalendarTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_google_calendar_connection',
    'Si esa persona tiene Google Calendar conectado. Conviene consultarlo antes de intentar crear una reunión: sin conexión, el resto de estas tools falla. Conectarse lo tiene que hacer ella desde la interfaz.',
    { userId },
    async ({ userId: id }: { userId: number }) =>
      deps.googleCalendarService.getConnection(id),
  );

  registerMcpTool(
    server,
    'list_google_calendar_meetings',
    'Las reuniones de esa persona: las que organizó y las que la tienen como invitada. Se puede acotar a un lead o una tarea.',
    {
      userId,
      entityKind: z
        .enum(['lead', 'task'])
        .optional()
        .describe('Acota a las reuniones ligadas a un lead o a una tarea'),
      entityId: z.number().int().positive().optional(),
    },
    async ({
      userId: id,
      entityKind,
      entityId,
    }: {
      userId: number;
      entityKind?: 'lead' | 'task';
      entityId?: number;
    }) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleCalendarService.listMeetings(user, entityKind, entityId);
    },
  );

  registerMcpTool(
    server,
    'create_google_calendar_meeting',
    'Crea una reunión con enlace de Meet en el calendario de esa persona y manda la invitación a los asistentes. Máximo 8 horas, y el fin tiene que ser posterior al inicio. entityKind y entityId van juntos o no van.',
    {
      userId,
      title: z.string().trim().min(1).max(255),
      startsAt: isoDateTime.describe('Inicio, con zona'),
      endsAt: isoDateTime.describe('Fin, con zona. Posterior al inicio y a menos de 8 horas'),
      timeZone,
      attendees: attendees.optional(),
      entityKind: z
        .enum(['lead', 'task'])
        .optional()
        .describe('Liga la reunión a un lead o a una tarea; exige entityId'),
      entityId: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Exige entityKind; los dos van juntos o ninguno'),
    },
    async ({ userId: id, ...dto }: { userId: number }) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleCalendarService.createMeeting(user, dto as never);
    },
  );

  registerMcpTool(
    server,
    'update_google_calendar_meeting',
    'Cambia una reunión ya creada. Google avisa a los invitados de cada cambio, así que mover la hora manda un correo a todos. Solo se tocan los campos presentes en la llamada.',
    {
      userId,
      id: meetingId,
      title: z.string().trim().min(1).max(255).optional(),
      startsAt: isoDateTime.optional(),
      endsAt: isoDateTime.optional(),
      timeZone: timeZone.optional(),
      attendees: attendees
        .optional()
        .describe('Reemplaza la lista entera: los que no estén quedan fuera'),
    },
    async ({ userId: uid, id, ...dto }: { userId: number; id: number }) => {
      const user = await deps.mcpActor.userAs(uid);
      return deps.googleCalendarService.updateMeeting(user, id, dto as never);
    },
  );

  registerMcpTool(
    server,
    'cancel_google_calendar_meeting',
    'Cancela la reunión y borra el evento del calendario de Google. Los invitados reciben la cancelación, así que esto se nota fuera del sistema y no se puede deshacer: la reunión habría que volver a crearla. Pide confirm=true.',
    {
      userId,
      id: meetingId,
      confirm: z
        .literal(true)
        .describe('Debe ser exactamente true. Confirma que se avise a los invitados.'),
    },
    async ({ userId: uid, id }: { userId: number; id: number; confirm: true }) => {
      const user = await deps.mcpActor.userAs(uid);
      await deps.googleCalendarService.cancelMeeting(user, id);
      return { id, cancelled: true, attendeesNotified: true };
    },
  );
}
