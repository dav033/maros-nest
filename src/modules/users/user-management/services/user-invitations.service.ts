import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User, UserStatus } from '../../../../entities/user.entity';
import { UserInvitation } from '../../../../entities/user-invitation.entity';
import {
  ExternalUserRoleException,
  RoleNotFoundException,
  UserAlreadyExistsException,
  UserNotFoundException,
  UserNotInvitedException,
} from '../../../../common/exceptions';
import type { AuthenticatedUser } from '../../../../common/auth/authenticated-user';
import { InviteUserDto } from '../dto/invite-user.dto';
import { UsersRepository } from '../repositories/users.repository';
import { RolesRepository } from '../repositories/roles.repository';
import {
  PENDING_INVITATION,
  UserInvitationsRepository,
} from '../repositories/user-invitations.repository';
import { UserInvitationNotificationsService } from './user-invitation-notifications.service';
import { UsersService } from '../users.service';

const DEFAULT_EXPIRES_IN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the caller is told about an invitation. */
export interface IssuedInvitation {
  id: number;
  expiresAt: Date;
}

/**
 * Why the door stayed shut, so the login page can say which of these it was instead of
 * falling back to "that domain is not allowed".
 */
export type InvitationDenialReason =
  | 'not_invited'
  | 'expired'
  | 'revoked'
  | 'disabled';

/** Answer for the Next.js Google callback, which has no session to authenticate with. */
export interface InvitationCheckResult {
  allowed: boolean;
  userId?: number;
  status?: UserStatus;
  reason?: InvitationDenialReason;
}

@Injectable()
export class UserInvitationsService {
  private readonly logger = new Logger(UserInvitationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersRepo: UsersRepository,
    private readonly rolesRepo: RolesRepository,
    private readonly invitationsRepo: UserInvitationsRepository,
    private readonly notifications: UserInvitationNotificationsService,
    private readonly users: UsersService,
  ) {}

  /**
   * Creates the account and emails the invitation as one unit.
   *
   * The send happens inside the transaction on purpose: a user row nobody was ever told
   * about is worse than no row at all, so a bounced or misconfigured SMTP rolls the
   * account back and the admin sees the failure instead of a silent half-invite. The
   * cost is holding the connection open for the length of an SMTP round-trip, which is
   * acceptable for something an admin does by hand a few times a month.
   */
  async invite(
    dto: InviteUserDto,
    actor: AuthenticatedUser,
  ): Promise<{ user: User; invitation: IssuedInvitation }> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.usersRepo.findByEmail(email);
    if (existing) throw new UserAlreadyExistsException(email);

    const role = await this.rolesRepo.findById(dto.roleId);
    if (!role) throw new RoleNotFoundException(dto.roleId);

    // El tipo de usuario y el rol son dos campos sueltos del formulario, así que sin
    // esto se puede invitar a alguien de fuera de Maros con el rol admin. Un externo
    // sólo entra con un rol sin permisos; el alcance por fila todavía no existe.
    // Se miran los permisos efectivos, no las filas guardadas: los roles de sistema
    // (admin, member) no tienen filas en role_permissions y se resuelven al catálogo
    // entero, así que contar filas daría cero justo para el rol más peligroso.
    if (
      dto.userType === 'external' &&
      this.users.effectivePermissions(role).length > 0
    ) {
      throw new ExternalUserRoleException(role.name);
    }

    return this.dataSource.transaction(async (manager) => {
      const user = new User();
      user.email = email;
      user.name = dto.name?.trim() || undefined;
      user.role = role;
      user.isActive = true;
      user.userType = dto.userType;
      user.status = 'invited';
      user.scopedCompanyId = dto.scopedCompanyId ?? null;
      user.scopedContactId = dto.scopedContactId ?? null;
      user.invitedById = actor.id;

      const created = await manager.getRepository(User).save(user);
      const invitation = await this.issue(manager, created, dto.expiresInDays, actor);
      // So the returned user carries the same pending invitation the user list shows.
      created.invitations = [invitation];

      this.logger.log(
        `User ${email} invited by ${actor.email} as ${dto.userType} (role ${role.name})`,
      );
      return { user: created, invitation: toIssued(invitation) };
    });
  }

  /** Supersedes the outstanding invitation with a fresh expiry. */
  async resend(userId: number, actor: AuthenticatedUser): Promise<IssuedInvitation> {
    const user = await this.usersRepo.findById(userId);
    if (!user) throw new UserNotFoundException(userId);
    if (user.status !== 'invited') throw new UserNotInvitedException(user.email);

    const invitation = await this.dataSource.transaction((manager) =>
      this.issue(manager, user, undefined, actor),
    );
    return toIssued(invitation);
  }

  /**
   * Cancels the invitation.
   *
   * Deactivating the account is part of cancelling, not an extra: `revoked_at` is what
   * checkAccess() refuses on, and the account is closed with it so an invitation nobody
   * may use does not linger as a live 'invited' row. The row itself is kept — who was invited, and by whom, is worth more than a
   * tidy table.
   */
  async revoke(userId: number): Promise<void> {
    const user = await this.usersRepo.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(UserInvitation)
        .update({ userId, ...PENDING_INVITATION }, { revokedAt: new Date() });

      if (user.status === 'invited') {
        await manager
          .getRepository(User)
          .update(userId, { isActive: false, status: 'disabled' });
      }
    });

    this.logger.log(`Invitation for user ${user.email} revoked`);
  }

  /**
   * The database answer to the question the Next.js callback used to answer from a
   * hardcoded allowlist: may this Google account have a session?
   *
   * This is the whole gate. Google proves who the person is; the invitation only says
   * they were expected, so its expiry and its revocation are enforced here or nowhere.
   *
   * An unknown address is always denied, so the callback must keep letting its own
   * Workspace domain through first — internal staff have no user row until their very
   * first login provisions one.
   */
  async checkAccess(email: string): Promise<InvitationCheckResult> {
    const normalized = email.trim().toLowerCase();
    const user = await this.usersRepo.findByEmail(normalized);
    if (!user) return { allowed: false, reason: 'not_invited' };

    if (!user.isActive || user.status === 'disabled') {
      // Cancelling an invitation also disables the account, so the invitation is what
      // tells "yours was cancelled" apart from "somebody turned your account off".
      const invitation = await this.invitationsRepo.findLatestByEmail(normalized);
      return {
        allowed: false,
        userId: user.id,
        status: 'disabled',
        reason: invitation?.revokedAt ? 'revoked' : 'disabled',
      };
    }

    if (user.status === 'invited') {
      const invitation = await this.invitationsRepo.findLatestByEmail(normalized);
      const reason = denialReason(invitation);
      return reason
        ? { allowed: false, userId: user.id, status: 'invited', reason }
        : { allowed: true, userId: user.id, status: 'invited' };
    }

    return { allowed: true, userId: user.id, status: user.status };
  }

  private async issue(
    manager: EntityManager,
    user: User,
    expiresInDays: number | undefined,
    actor: AuthenticatedUser,
  ): Promise<UserInvitation> {
    const invitations = manager.getRepository(UserInvitation);

    // At most one invitation per user may be pending (partial unique index), so
    // whatever is open is superseded before the new one is written.
    await invitations.update(
      { userId: user.id, ...PENDING_INVITATION },
      { revokedAt: new Date() },
    );

    const invitation = new UserInvitation();
    invitation.userId = user.id;
    invitation.email = user.email;
    invitation.expiresAt = new Date(
      Date.now() + (expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS) * DAY_MS,
    );
    invitation.invitedById = actor.id;

    const saved = await invitations.save(invitation);

    // Not swallowed: a failure here must roll the surrounding transaction back.
    await this.notifications.sendInvitation({
      email: user.email,
      name: user.name ?? null,
      inviterName: actor.name,
      expiresAt: saved.expiresAt,
    });

    return saved;
  }
}

/** Why this invitation cannot open the door, or null if it can. */
function denialReason(
  invitation: UserInvitation | null,
): InvitationDenialReason | null {
  if (!invitation || invitation.acceptedAt) return 'not_invited';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.expiresAt.getTime() <= Date.now()) return 'expired';
  return null;
}

function toIssued(invitation: UserInvitation): IssuedInvitation {
  return {
    id: invitation.id,
    expiresAt: invitation.expiresAt,
  };
}
