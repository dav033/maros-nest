import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPreferences, User } from '../../../entities/user.entity';
import { Role } from '../../../entities/role.entity';
import {
  LastAdminException,
  RoleNotFoundException,
  SelfModificationException,
  UserInactiveException,
  UserNotFoundException,
} from '../../../common/exceptions';
import {
  isPermission,
  Permission,
  PERMISSIONS,
  MEMBER_PERMISSIONS,
  SYSTEM_ROLE_ADMIN,
  SYSTEM_ROLE_MEMBER,
} from '../../../common/auth/permissions';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { UsersRepository } from './repositories/users.repository';
import { RolesRepository } from './repositories/roles.repository';
import { UserInvitationsRepository } from './repositories/user-invitations.repository';

/** Identity proven by the session JWT, before it is matched to a user row. */
export interface VerifiedIdentity {
  email: string;
  name?: string;
  picture?: string;
}

/** Avoids a write on every single request just to bump last_login_at. */
const LAST_LOGIN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * How long a resolved identity may be reused without going back to the database.
 *
 * Deliberately short. Resolving permissions per request is what makes a role
 * change or a deactivation take effect at once instead of waiting out the
 * token's 30-day life, and that property is not for sale — but the database is
 * 130 ms away, so doing it literally every request taxed every endpoint in the
 * app. The bound on staleness is therefore this TTL *and* explicit
 * invalidation: anything that changes who a user is or what they may do calls
 * invalidateResolvedUser / invalidateAllResolvedUsers, which makes the change
 * visible on the very next request. The TTL is only the backstop for a path
 * that forgets to.
 */
const RESOLVED_USER_TTL_MS = 30 * 1000;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  /** Resolved identities by normalized email — see RESOLVED_USER_TTL_MS. */
  private readonly resolvedUsers = new Map<
    string,
    { value: AuthenticatedUser; expiresAt: number }
  >();

  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly rolesRepo: RolesRepository,
    private readonly invitationsRepo: UserInvitationsRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolves the JWT identity into a full user with effective permissions,
   * provisioning the account on first sight.
   *
   * Called on every authenticated request. The result is cached for
   * RESOLVED_USER_TTL_MS and dropped explicitly whenever the user or their role
   * changes, so role changes and deactivations still take effect immediately
   * instead of waiting out the 30-day token lifetime.
   */
  async resolveForRequest(identity: VerifiedIdentity): Promise<AuthenticatedUser> {
    const email = this.normalizeEmail(identity.email);

    const cached = this.resolvedUsers.get(email);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let user = await this.usersRepo.findByEmail(email);

    if (!user) {
      user = await this.provision(email, identity);
    }

    // Never cached: a deactivated account throws before reaching the cache
    // write, so it can never be served from memory.
    if (!user.isActive) {
      this.resolvedUsers.delete(email);
      throw new UserInactiveException(user.email);
    }

    await this.acceptInvitationIfPending(user);
    await this.touchLastLoginIfStale(user);

    const resolved = this.toAuthenticatedUser(user);
    this.resolvedUsers.set(email, {
      value: resolved,
      expiresAt: Date.now() + RESOLVED_USER_TTL_MS,
    });
    return resolved;
  }

  /**
   * Drops one cached identity. Call after anything that changes who a user is
   * or what they are allowed to do, so the next request re-reads them.
   */
  invalidateResolvedUser(email: string): void {
    this.resolvedUsers.delete(this.normalizeEmail(email));
  }

  /**
   * Drops every cached identity — for changes that can affect many users at
   * once, such as editing or deleting a role.
   */
  invalidateAllResolvedUsers(): void {
    this.resolvedUsers.clear();
  }

  /** Returns an existing user ID for local development without provisioning or touching it. */
  async findExistingDevActor(id: number): Promise<number | null> {
    const user = await this.usersRepo.findById(id);
    return user?.id ?? null;
  }

  async findAll(): Promise<User[]> {
    return this.usersRepo.findAll();
  }

  /** Minimal directory of active colleagues — see UsersController.findUserDirectory. */
  async findDirectory(): Promise<
    Array<{ id: number; name: string | null; email: string; picture: string | null }>
  > {
    const users = await this.usersRepo.findActiveDirectory();
    return users.map((user) => ({
      id: user.id,
      name: user.name ?? null,
      email: user.email,
      picture: user.picture ?? null,
    }));
  }

  async findById(id: number): Promise<User> {
    const user = await this.usersRepo.findById(id);
    if (!user) throw new UserNotFoundException(id);
    return user;
  }

  async getNotificationPreferences(id: number): Promise<NotificationPreferences> {
    const user = await this.findById(id);
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(user.notificationPreferences ?? {}) };
  }

  async updateNotificationPreferences(
    id: number,
    patch: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const user = await this.findById(id);
    user.notificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(user.notificationPreferences ?? {}),
      ...patch,
    };
    await this.usersRepo.save(user);
    return user.notificationPreferences;
  }

  /**
   * Updates a user's role and/or active flag.
   *
   * `actingUserId` is the caller: they may not change their own role or
   * deactivate themselves, and they may not strip the last remaining admin —
   * either would leave the CRM with nobody able to administer it.
   */
  async update(
    id: number,
    changes: { roleId?: number; isActive?: boolean },
    actingUserId: number,
  ): Promise<User> {
    const user = await this.findById(id);

    const changesRole =
      changes.roleId !== undefined && changes.roleId !== user.role?.id;
    const changesActive =
      changes.isActive !== undefined && changes.isActive !== user.isActive;

    if (!changesRole && !changesActive) {
      return user;
    }

    if (id === actingUserId) {
      throw new SelfModificationException();
    }

    if (user.role?.name === SYSTEM_ROLE_ADMIN) {
      const losingAdmin = changesRole || changes.isActive === false;
      if (losingAdmin) {
        await this.assertNotLastAdmin(id);
      }
    }

    if (changesRole) {
      const role = await this.rolesRepo.findById(changes.roleId!);
      if (!role) throw new RoleNotFoundException(changes.roleId!);
      user.role = role;
    }

    if (changesActive) {
      user.isActive = changes.isActive!;
      // Status is what the admin list shows; letting it say "active" for an account
      // somebody just switched off would be a lie about who can sign in.
      // 'invited' significa "todavia no ha entrado nunca" y es ortogonal al
      // interruptor de activo: sobreescribirlo perderia que la invitacion sigue
      // sin aceptarse. Solo lo cambia acceptInvitationIfPending, en el primer login.
      if (user.status !== 'invited') {
        user.status = user.isActive ? 'active' : 'disabled';
      }
    }

    const saved = await this.usersRepo.save(user);
    // A new role or a flipped isActive must bite on the very next request, not
    // when the 30 s cache entry happens to lapse.
    this.invalidateResolvedUser(saved.email);
    return saved;
  }

  private async assertNotLastAdmin(userId: number): Promise<void> {
    const remaining = await this.usersRepo.countActiveByRoleNameExcluding(
      SYSTEM_ROLE_ADMIN,
      userId,
    );
    if (remaining === 0) {
      throw new LastAdminException();
    }
  }

  private async provision(
    email: string,
    identity: VerifiedIdentity,
  ): Promise<User> {
    const role = await this.resolveInitialRole(email);

    const user = new User();
    user.email = email;
    user.name = identity.name ?? undefined;
    user.picture = identity.picture ?? undefined;
    user.role = role;
    user.isActive = true;
    // Self-provisioned through Google: staff, already through the door.
    user.userType = 'internal';
    user.status = 'active';

    try {
      const created = await this.usersRepo.save(user);
      this.logger.log(
        `Provisioned user ${email} with role ${role?.name ?? 'none'}`,
      );
      return created;
    } catch (error) {
      // Two concurrent first requests race on the unique email index; the
      // loser just re-reads the row the winner created.
      const existing = await this.usersRepo.findByEmail(email);
      if (existing) return existing;
      throw error;
    }
  }

  private async resolveInitialRole(email: string): Promise<Role | null> {
    if (this.bootstrapAdmins().includes(email)) {
      const admin = await this.rolesRepo.findByName(SYSTEM_ROLE_ADMIN);
      if (admin) return admin;
      this.logger.warn(
        `${email} is listed in AUTH_BOOTSTRAP_ADMINS but the admin role is missing — has db/create-users-tables.sql been applied?`,
      );
    }

    const defaultRoleName =
      this.configService.get<string>('AUTH_DEFAULT_ROLE') ?? 'Solo task';
    const role = await this.rolesRepo.findByName(defaultRoleName);
    if (!role) {
      this.logger.warn(
        `Default role "${defaultRoleName}" not found; provisioning with no role (no permissions)`,
      );
    }
    return role;
  }

  private bootstrapAdmins(): string[] {
    const raw = this.configService.get<string>('AUTH_BOOTSTRAP_ADMINS') ?? '';
    return raw
      .split(',')
      .map((entry) => this.normalizeEmail(entry))
      .filter(Boolean);
  }

  /**
   * The first arrival closes the invitation.
   *
   * Whether they were allowed in at all was already settled by
   * POST /auth/invitations/check before the session was minted; this only records that
   * the person actually showed up, so the admin list stops offering to resend.
   */
  private async acceptInvitationIfPending(user: User): Promise<void> {
    if (user.status !== 'invited') return;

    const pending = await this.invitationsRepo.findPendingByUserId(user.id);
    if (pending) {
      await this.invitationsRepo.markAccepted(pending.id, new Date());
    }

    user.status = 'active';
    await this.usersRepo.updateStatus(user.id, 'active');
    this.logger.log(`User ${user.email} accepted their invitation`);
  }

  private async touchLastLoginIfStale(user: User): Promise<void> {
    const last = user.lastLoginAt?.getTime() ?? 0;
    if (Date.now() - last < LAST_LOGIN_THROTTLE_MS) return;

    const now = new Date();
    user.lastLoginAt = now;
    await this.usersRepo.touchLastLogin(user.id, now);
  }

  toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      picture: user.picture ?? null,
      role: user.role ? { id: user.role.id, name: user.role.name } : null,
      permissions: this.effectivePermissions(user.role),
      userType: user.userType ?? 'internal',
    };
  }

  /**
   * The admin system role resolves to the entire catalog rather than to stored
   * rows, so that adding a permission code in a later release can never leave
   * admins locked out of the feature it guards.
   */
  effectivePermissions(role: Role | null): Permission[] {
    if (!role) return [];
    if (role.isSystem && role.name === SYSTEM_ROLE_ADMIN) {
      return [...PERMISSIONS];
    }
    if (role.isSystem && role.name === SYSTEM_ROLE_MEMBER) {
      return [...MEMBER_PERMISSIONS];
    }
    return (role.permissions ?? [])
      .map((entry) => entry.permission)
      .filter(isPermission);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
