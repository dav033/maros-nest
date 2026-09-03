import { UsersService } from './users.service';
import { User } from '../../../entities/user.entity';
import { Role } from '../../../entities/role.entity';
import {
  LastAdminException,
  SelfModificationException,
  UserInactiveException,
  UserNotFoundException,
} from '../../../common/exceptions';
import { SYSTEM_ROLE_ADMIN, SYSTEM_ROLE_MEMBER } from '../../../common/auth/permissions';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    name: SYSTEM_ROLE_MEMBER,
    isSystem: true,
    permissions: [],
    users: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Role;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'user@marosconstruction.com',
    isActive: true,
    role: makeRole(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

function makeService(
  usersRepo: Record<string, jest.Mock>,
  rolesRepo: Record<string, jest.Mock> = {},
  configValues: Record<string, string | undefined> = {},
) {
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };
  return new UsersService(usersRepo as never, rolesRepo as never, configService as never);
}

describe('UsersService.resolveForRequest', () => {
  it('provisions a new user with the default role on first login', async () => {
    const memberRole = makeRole({ id: 2, name: SYSTEM_ROLE_MEMBER });
    const usersRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      save: jest
        .fn()
        .mockImplementation((user: User) => Promise.resolve(Object.assign(user, { id: 42 }))),
      touchLastLogin: jest.fn(),
    };
    const rolesRepo = {
      findByName: jest.fn().mockResolvedValue(memberRole),
    };
    const service = makeService(usersRepo, rolesRepo);

    const result = await service.resolveForRequest({ email: 'New@Marosconstruction.com' });

    expect(usersRepo.save).toHaveBeenCalledTimes(1);
    const savedUser = usersRepo.save.mock.calls[0][0] as User;
    expect(savedUser.email).toBe('new@marosconstruction.com');
    expect(savedUser.role).toBe(memberRole);
    expect(result.id).toBe(42);
    expect(result.role?.name).toBe(SYSTEM_ROLE_MEMBER);
  });

  it('provisions with the admin role when the email is bootstrap-listed', async () => {
    const adminRole = makeRole({ id: 1, name: SYSTEM_ROLE_ADMIN });
    const usersRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((user: User) => Promise.resolve(user)),
      touchLastLogin: jest.fn(),
    };
    const rolesRepo = { findByName: jest.fn().mockResolvedValue(adminRole) };
    const service = makeService(usersRepo, rolesRepo, {
      AUTH_BOOTSTRAP_ADMINS: 'boss@marosconstruction.com, other@marosconstruction.com',
    });

    await service.resolveForRequest({ email: 'boss@marosconstruction.com' });

    expect(rolesRepo.findByName).toHaveBeenCalledWith(SYSTEM_ROLE_ADMIN);
  });

  it('rejects a deactivated user without provisioning or touching last_login', async () => {
    const usersRepo = {
      findByEmail: jest.fn().mockResolvedValue(makeUser({ isActive: false })),
      save: jest.fn(),
      touchLastLogin: jest.fn(),
    };
    const service = makeService(usersRepo, {});

    await expect(
      service.resolveForRequest({ email: 'user@marosconstruction.com' }),
    ).rejects.toThrow(UserInactiveException);
    expect(usersRepo.touchLastLogin).not.toHaveBeenCalled();
  });

  it('throttles last_login writes to once per 5 minutes', async () => {
    const recent = makeUser({ lastLoginAt: new Date(Date.now() - 60 * 1000) });
    const usersRepo = {
      findByEmail: jest.fn().mockResolvedValue(recent),
      touchLastLogin: jest.fn(),
    };
    const service = makeService(usersRepo, {});

    await service.resolveForRequest({ email: recent.email });

    expect(usersRepo.touchLastLogin).not.toHaveBeenCalled();
  });

  it('updates last_login when the throttle window has passed', async () => {
    const stale = makeUser({ lastLoginAt: new Date(Date.now() - 10 * 60 * 1000) });
    const usersRepo = {
      findByEmail: jest.fn().mockResolvedValue(stale),
      touchLastLogin: jest.fn(),
    };
    const service = makeService(usersRepo, {});

    await service.resolveForRequest({ email: stale.email });

    expect(usersRepo.touchLastLogin).toHaveBeenCalledWith(stale.id, expect.any(Date));
  });
});

describe('UsersService.update — safety rules', () => {
  it('throws UserNotFoundException for an unknown id', async () => {
    const usersRepo = { findById: jest.fn().mockResolvedValue(null) };
    const service = makeService(usersRepo, {});

    await expect(service.update(999, { isActive: false }, 1)).rejects.toThrow(
      UserNotFoundException,
    );
  });

  it('blocks a user from deactivating themselves', async () => {
    const self = makeUser({ id: 5 });
    const usersRepo = { findById: jest.fn().mockResolvedValue(self) };
    const service = makeService(usersRepo, {});

    await expect(service.update(5, { isActive: false }, 5)).rejects.toThrow(
      SelfModificationException,
    );
  });

  it('blocks a user from changing their own role', async () => {
    const self = makeUser({ id: 5, role: makeRole({ id: 1 }) });
    const usersRepo = { findById: jest.fn().mockResolvedValue(self) };
    const service = makeService(usersRepo, {});

    await expect(service.update(5, { roleId: 2 }, 5)).rejects.toThrow(
      SelfModificationException,
    );
  });

  it('is a no-op (no self-modification error) when nothing actually changes', async () => {
    const self = makeUser({ id: 5, role: makeRole({ id: 1 }), isActive: true });
    const usersRepo = { findById: jest.fn().mockResolvedValue(self) };
    const service = makeService(usersRepo, {});

    const result = await service.update(5, { roleId: 1, isActive: true }, 5);

    expect(result).toBe(self);
  });

  it('blocks deactivating the last active admin', async () => {
    const admin = makeUser({ id: 3, role: makeRole({ name: SYSTEM_ROLE_ADMIN }) });
    const usersRepo = {
      findById: jest.fn().mockResolvedValue(admin),
      countActiveByRoleNameExcluding: jest.fn().mockResolvedValue(0),
    };
    const service = makeService(usersRepo, {});

    await expect(service.update(3, { isActive: false }, 1)).rejects.toThrow(
      LastAdminException,
    );
  });

  it('blocks demoting the last active admin to a different role', async () => {
    const admin = makeUser({ id: 3, role: makeRole({ id: 1, name: SYSTEM_ROLE_ADMIN }) });
    const usersRepo = {
      findById: jest.fn().mockResolvedValue(admin),
      countActiveByRoleNameExcluding: jest.fn().mockResolvedValue(0),
    };
    const service = makeService(usersRepo, {});

    await expect(service.update(3, { roleId: 2 }, 1)).rejects.toThrow(LastAdminException);
  });

  it('allows deactivating an admin when another active admin remains', async () => {
    const admin = makeUser({ id: 3, role: makeRole({ name: SYSTEM_ROLE_ADMIN }) });
    const usersRepo = {
      findById: jest.fn().mockResolvedValue(admin),
      countActiveByRoleNameExcluding: jest.fn().mockResolvedValue(1),
      save: jest.fn().mockImplementation((u: User) => Promise.resolve(u)),
    };
    const service = makeService(usersRepo, {});

    const result = await service.update(3, { isActive: false }, 1);

    expect(result.isActive).toBe(false);
  });

  it('applies a role change for a non-admin without checking last-admin count', async () => {
    const member = makeUser({ id: 4, role: makeRole({ id: 1, name: SYSTEM_ROLE_MEMBER }) });
    const newRole = makeRole({ id: 2, name: 'sales' });
    const usersRepo = {
      findById: jest.fn().mockResolvedValue(member),
      countActiveByRoleNameExcluding: jest.fn(),
      save: jest.fn().mockImplementation((u: User) => Promise.resolve(u)),
    };
    const rolesRepo = { findById: jest.fn().mockResolvedValue(newRole) };
    const service = makeService(usersRepo, rolesRepo);

    const result = await service.update(4, { roleId: 2 }, 1);

    expect(usersRepo.countActiveByRoleNameExcluding).not.toHaveBeenCalled();
    expect(result.role).toBe(newRole);
  });
});

describe('UsersService.effectivePermissions', () => {
  it('resolves the admin system role to the entire catalog', () => {
    const service = makeService({}, {});
    const adminRole = makeRole({ name: SYSTEM_ROLE_ADMIN, isSystem: true, permissions: [] });

    const permissions = service.effectivePermissions(adminRole);

    expect(permissions).toContain('finance:read');
    expect(permissions).toContain('users:write');
    expect(permissions.length).toBeGreaterThan(5);
  });

  it('resolves the member system role with finance read access', () => {
    const service = makeService({}, {});
    const memberRole = makeRole({ name: SYSTEM_ROLE_MEMBER, isSystem: true, permissions: [] });

    expect(service.effectivePermissions(memberRole)).toContain('finance:read');
  });

  it('resolves a custom role from its stored rows only', () => {
    const service = makeService({}, {});
    const role = makeRole({
      name: 'sales',
      isSystem: false,
      permissions: [
        { roleId: 1, permission: 'leads:read' } as never,
        { roleId: 1, permission: 'leads:write' } as never,
      ],
    });

    expect(service.effectivePermissions(role)).toEqual(['leads:read', 'leads:write']);
  });

  it('returns no permissions for a null role', () => {
    const service = makeService({}, {});

    expect(service.effectivePermissions(null)).toEqual([]);
  });
});
