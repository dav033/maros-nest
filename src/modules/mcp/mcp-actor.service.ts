import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { TaskActor } from '../tasks/task-management/services/task-actor';
import { UsersRepository } from '../users/user-management/repositories/users.repository';
import { UsersService } from '../users/user-management/users.service';

/**
 * Correo de la fila con la que firma el MCP. El dominio `.invalid` está
 * reservado por el RFC 2606 y no resuelve nunca, así que nadie puede llegar a
 * controlarlo en Google. Se crea con `db/add-mcp-system-user.sql`.
 */
export const MCP_ACTOR_EMAIL = 'mcp-agent@maros.invalid';

/**
 * Quién es el MCP cuando escribe.
 *
 * Los document scans aceptan un autor nulo, pero las tareas y las invitaciones
 * no: el reporter de una tarea, su log de actividad y
 * `user_invitations.invited_by_id` necesitan un id real. El MCP se autentica con
 * un token compartido y no representa a ninguna persona, así que firma como una
 * fila de sistema en vez de hacerse pasar por un empleado. En el log de
 * actividad se distingue a simple vista lo que hizo el agente.
 *
 * Si la fila no existe, se falla con el nombre del archivo SQL que la crea: es
 * mucho más rápido de diagnosticar que un error de clave ajena.
 */
@Injectable()
export class McpActorService {
  // La fila es de sistema y no cambia; se resuelve una vez por proceso.
  private cached: AuthenticatedUser | null = null;

  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly users: UsersService,
  ) {}

  async authenticatedUser(): Promise<AuthenticatedUser> {
    if (this.cached) return this.cached;

    const user = await this.usersRepo.findByEmail(MCP_ACTOR_EMAIL);
    if (!user) {
      throw new InternalServerErrorException(
        `El usuario de sistema del MCP (${MCP_ACTOR_EMAIL}) no existe. ` +
          'Aplica db/add-mcp-system-user.sql antes de usar las tools que escriben.',
      );
    }

    this.cached = this.users.toAuthenticatedUser(user);
    return this.cached;
  }

  /**
   * `canDelete: false` a propósito: gobierna si se puede editar o borrar el
   * comentario de otra persona (ver TaskCommentsService). El agente escribe
   * comentarios propios; los ajenos no son suyos para tocar.
   */
  async taskActor(): Promise<TaskActor> {
    const { id } = await this.authenticatedUser();
    return { id, canDelete: false };
  }

  /**
   * Actuar **como otra persona**. Es el único sitio del MCP donde eso pasa, a
   * propósito: si algún día hay que auditarlo o quitarlo, está aquí.
   *
   * Existe por Google Calendar y nada más. La conexión con Google es por usuario
   * (`google_calendar_connections.user_id`) y el usuario de sistema del MCP no
   * puede autorizarla nunca, porque no puede iniciar sesión. O las tools de
   * calendario actúan como alguien con conexión propia, o fallan siempre.
   *
   * Lo que implica, sin rodeos: la reunión se crea en el calendario de Google de
   * esa persona y los invitados reciben el correo de su parte. Por eso el
   * `userId` es un parámetro explícito de cada tool y no un valor por defecto.
   *
   * Se rechaza suplantar una cuenta desactivada: si alguien ya no tiene acceso,
   * el agente tampoco debe actuar en su nombre.
   */
  async userAs(userId: number): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user.isActive) {
      throw new BadRequestException(
        `La cuenta de ${user.email} está desactivada; el MCP no actúa en nombre de alguien sin acceso.`,
      );
    }
    return this.users.toAuthenticatedUser(user);
  }
}
