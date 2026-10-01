import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Usuarios e invitaciones.
 *
 * Deliberadamente NO hay tool para cambiar el rol de alguien, ni para activarlo
 * o desactivarlo. El MCP se autentica con un único token compartido que no
 * identifica a nadie: si ese token se filtra, una tool de roles lo convertiría
 * en una llave de escalada de privilegios. Esos cambios siguen pasando por la
 * UI, con la sesión de una persona detrás.
 *
 * Lo que sí hay es invitar, reenviar y revocar, que es lo que se hace a mano
 * unas pocas veces al mes. Las dos protecciones del servicio siguen en pie y no
 * se eluden por venir del MCP:
 *   - un usuario `external` no puede recibir un rol con permisos efectivos;
 *   - el envío del correo ocurre dentro de la transacción, así que un SMTP
 *     caído deshace la cuenta en vez de dejar a alguien invitado sin aviso.
 *
 * `invited_by_id` queda apuntando al usuario de sistema del MCP, nunca a una
 * persona que no apretó el botón.
 */

const userId = z.number().int().positive();

export function registerUserTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'list_users',
    'Todos los usuarios con su rol, tipo (internal/external), estado e invitaciones. Sirve para resolver un nombre a un id antes de asignar una tarea.',
    {},
    async () => deps.usersService.findAll(),
  );

  registerMcpTool(
    server,
    'get_user',
    'Un usuario por id.',
    { id: userId },
    async ({ id }: { id: number }) => deps.usersService.findById(id),
  );

  registerMcpTool(
    server,
    'list_roles',
    'Los roles disponibles con sus permisos. El roleId de invite_user sale de acá.',
    {},
    async () => deps.rolesService.findAll(),
  );

  registerMcpTool(
    server,
    'invite_user',
    'Crea la cuenta y envía el correo de invitación en una sola operación. La persona entra después con su propia cuenta de Google. Un usuario external solo acepta un rol sin permisos; si el rol los tiene, la llamada falla. Si el correo no sale, la cuenta no se crea.',
    {
      email: z.string().email().describe('A quién se invita'),
      roleId: z
        .number()
        .int()
        .positive()
        .describe('Rol a asignar; sale de list_roles'),
      userType: z
        .enum(['internal', 'external'])
        .describe('internal = personal de Maros; external = cliente o tercero'),
      name: z.string().max(255).optional().describe('Nombre mostrado en el correo'),
      scopedCompanyId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Empresa del externo. Se guarda y se devuelve, pero todavía no filtra nada'),
      scopedContactId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Contacto del externo. Se guarda y se devuelve, pero todavía no filtra nada'),
      expiresInDays: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe('Días de validez de la invitación; 7 si se omite'),
    },
    async (dto: Record<string, unknown>) =>
      deps.userInvitationsService.invite(
        dto as never,
        await deps.mcpActor.authenticatedUser(),
      ),
  );

  registerMcpTool(
    server,
    'resend_invitation',
    'Reemplaza la invitación pendiente por una nueva con fecha de caducidad fresca y vuelve a enviar el correo. Solo sirve con usuarios en estado "invited".',
    { userId },
    async ({ userId: id }: { userId: number }) =>
      deps.userInvitationsService.resend(
        id,
        await deps.mcpActor.authenticatedUser(),
      ),
  );

  registerMcpTool(
    server,
    'revoke_invitation',
    'Cancela la invitación pendiente. Si la persona todavía no había entrado, su cuenta queda desactivada. La fila de la invitación se conserva: quién invitó a quién es historia que vale guardarse.',
    { userId },
    async ({ userId: id }: { userId: number }) =>
      deps.userInvitationsService
        .revoke(id)
        .then(() => ({ userId: id, revoked: true })),
  );

  registerMcpTool(
    server,
    'check_user_access',
    'Responde si una dirección puede recibir sesión, y por qué no si no puede (not_invited, disabled, revoked, expired). Es la misma comprobación que hace el login para los externos.',
    { email: z.string().email() },
    async ({ email }: { email: string }) =>
      deps.userInvitationsService.checkAccess(email),
  );
}
