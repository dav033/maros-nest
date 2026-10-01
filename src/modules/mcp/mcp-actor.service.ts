import { Injectable, InternalServerErrorException } from '@nestjs/common';
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
}
