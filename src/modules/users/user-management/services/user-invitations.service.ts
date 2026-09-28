import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { User, UserStatus } from '../../../../entities/user.entity';
import { UserInvitation } from '../../../../entities/user-invitation.entity';
import {
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

const DEFAULT_EXPIRES_IN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 32 bytes = 256 bits, same shape as the note share tokens. */
const TOKEN_BYTES = 32;

/** What the caller is told about an invitation. Never the token itself. */
export interface IssuedInvitation {
  id: number;
  expiresAt: Date;
  tokenHint: string;
}

/** Answer for the Next.js Google callback, which has no session to authenticate with. */
export interface InvitationCheckResult {
  allowed: boolean;
  userId?: number;
  status?: UserStatus;
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

  /** Supersedes the outstanding invitation with a fresh token and expiry. */
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
   * Deactivating the account is part of cancelling, not an extra: an 'invited' row left
   * active still passes checkAccess(), so revoking only the token would leave the door
   * open. The row itself is kept — who was invited, and by whom, is worth more than a
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
   * An unknown address is always denied, so the callback must keep letting its own
   * Workspace domain through first — internal staff have no user row until their very
   * first login provisions one.
   */
  async checkAccess(email: string): Promise<InvitationCheckResult> {
    const user = await this.usersRepo.findByEmail(email.trim().toLowerCase());
    if (!user) return { allowed: false };

    if (!user.isActive || user.status === 'disabled') {
      return { allowed: false, userId: user.id, status: 'disabled' };
    }

    if (user.status === 'invited') {
      // An expiry nobody enforces is decoration.
      const pending = await this.invitationsRepo.findPendingByUserId(user.id);
      const usable = !!pending && pending.expiresAt.getTime() > Date.now();
      return { allowed: usable, userId: user.id, status: 'invited' };
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

    // The token exists in the emailed link and nowhere else; only its SHA-256 is
    // stored. 256 bits of entropy need no key stretching — see share-token.util.ts.
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    const invitation = new UserInvitation();
    invitation.userId = user.id;
    invitation.email = user.email;
    invitation.tokenHash = createHash('sha256').update(token).digest('hex');
    invitation.tokenHint = token.slice(0, 8);
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
      token,
      expiresAt: saved.expiresAt,
    });

    return saved;
  }
}

function toIssued(invitation: UserInvitation): IssuedInvitation {
  return {
    id: invitation.id,
    expiresAt: invitation.expiresAt,
    tokenHint: invitation.tokenHint,
  };
}
