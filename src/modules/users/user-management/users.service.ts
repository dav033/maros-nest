import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../../../entities/user.entity';
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
  SYSTEM_ROLE_ADMIN,
  SYSTEM_ROLE_MEMBER,
} from '../../../common/auth/permissions';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { UsersRepository } from './repositories/users.repository';
import { RolesRepository } from './repositories/roles.repository';

/** Identity proven by the session JWT, before it is matched to a user row. */
export interface VerifiedIdentity {
  email: string;
  name?: string;
  picture?: string;
}

/** Avoids a write on every single request just to bump last_login_at. */
const LAST_LOGIN_THROTTLE_MS = 5 * 60 * 1000;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly rolesRepo: RolesRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolves the JWT identity into a full user with effective permissions,
   * provisioning the account on first sight.
   *
   * Called on every authenticated request, which is what makes role changes
   * and deactivations take effect immediately instead of waiting out the
   * 30-day token lifetime.
   */
  async resolveForRequest(identity: VerifiedIdentity): Promise<AuthenticatedUser> {
    const email = this.normalizeEmail(identity.email);
    let user = await this.usersRepo.findByEmail(email);

    if (!user) {
      user = await this.provision(email, identity);
    }

    if (!user.isActive) {
      throw new UserInactiveException(user.email);
    }

    await this.touchLastLoginIfStale(user);

    return this.toAuthenticatedUser(user);
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
    }

    return this.usersRepo.save(user);
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
      this.configService.get<string>('AUTH_DEFAULT_ROLE') ?? SYSTEM_ROLE_MEMBER;
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
    return (role.permissions ?? [])
      .map((entry) => entry.permission)
      .filter(isPermission);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
