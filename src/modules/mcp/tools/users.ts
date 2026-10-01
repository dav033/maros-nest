import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
} from '../../../common/auth/permissions';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Usuarios, invitaciones, roles y permisos.
 *
 * Alcance completo por decisión explícita del dueño del sistema: el MCP lo usa
 * una sola persona, así que su token lleva todo el poder, incluido cambiar roles
 * y activar o desactivar cuentas.
 *
 * Lo que eso implica, para que quede escrito: `MCP_TOKEN` pasa a ser una
 * credencial de nivel administrador. Quien lo tenga puede darse a sí mismo el rol
 * admin a través de `update_user`. Vale lo mismo que la contraseña de un admin y
 * hay que tratarlo así — ver la nota sobre el token en query string en
 * `guards/mcp-auth.guard.ts`.
 *
 * Las protecciones del servicio NO se eluden por venir del MCP, y es a propósito
 * que no las toco:
 *   - no se puede dejar el sistema sin ningún admin activo (`LastAdminException`);
 *   - un usuario `external` no puede recibir un rol con permisos efectivos;
 *   - un rol de sistema no se renombra ni se borra, y un rol en uso no se borra;
 *   - al invitar, el correo se envía dentro de la transacción, así que un SMTP
 *     caído deshace la cuenta en vez de dejar a alguien invitado sin aviso.
 *
 * `invited_by_id` y el actor de los cambios apuntan al usuario de sistema del
 * MCP, nunca a una persona que no apretó el botón. Como ese usuario nunca es el
 * destinatario, `SelfModificationException` no salta por accidente — y el MCP
 * tampoco puede bloquearse a sí mismo.
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
    'update_user',
    'Cambia el rol de un usuario, lo activa o lo desactiva. Desactivar le quita el acceso en la siguiente petición, no cuando caduque la caché. No se puede dejar el sistema sin ningún admin activo: esa llamada falla.',
    {
      id: userId,
      roleId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Rol nuevo; sale de list_roles'),
      isActive: z
        .boolean()
        .optional()
        .describe('false le quita el acceso; true lo devuelve'),
    },
    async ({
      id,
      ...changes
    }: {
      id: number;
      roleId?: number;
      isActive?: boolean;
    }) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.usersService.update(id, changes, actor.id);
    },
  );

  registerMcpTool(
    server,
    'list_permissions',
    'El catálogo de permisos que acepta un rol, agrupado como en el editor. Los nombres de create_role y update_role salen de acá; uno desconocido hace fallar la llamada.',
    {},
    // Constantes en codigo, no hay nada que esperar: Promise.resolve en vez de
    // un async sin await, que el lint marca con razon.
    () => Promise.resolve({ permissions: PERMISSIONS, groups: PERMISSION_GROUPS }),
  );

  registerMcpTool(
    server,
    'create_role',
    'Crea un rol con sus permisos. El nombre tiene que estar libre y cada permiso tiene que existir en list_permissions.',
    {
      name: z.string().trim().min(1).max(100),
      permissions: z
        .array(z.enum(PERMISSIONS as unknown as [string, ...string[]]))
        .describe('Permisos exactos del rol; lista vacía = rol sin permisos'),
      description: z.string().max(255).optional(),
    },
    async (input: { name: string; permissions: string[]; description?: string }) =>
      deps.rolesService.create(input as never),
  );

  registerMcpTool(
    server,
    'update_role',
    'Cambia nombre, descripción o permisos de un rol. CUIDADO: reescribe los permisos de TODOS los que tengan ese rol, no de uno. Los roles de sistema (admin, member) no se renombran.',
    {
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(255).optional(),
      permissions: z
        .array(z.enum(PERMISSIONS as unknown as [string, ...string[]]))
        .optional()
        .describe('Reemplaza la lista entera, no se suma a la que había'),
    },
    async ({ id, ...changes }: { id: number }) =>
      deps.rolesService.update(id, changes as never),
  );

  registerMcpTool(
    server,
    'delete_role',
    'Borra un rol. Falla si es de sistema o si algún usuario lo tiene asignado. Pide confirm=true porque no se puede deshacer.',
    {
      id: z.number().int().positive(),
      confirm: z
        .literal(true)
        .describe('Debe ser exactamente true. Confirma un borrado irreversible.'),
    },
    async ({ id }: { id: number; confirm: true }) =>
      deps.rolesService.delete(id).then(() => ({ id, deleted: true })),
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
