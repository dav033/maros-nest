import { RolesService } from './roles.service';
import { Role } from '../../../../entities/role.entity';
import {
  RoleInUseException,
  RoleNameConflictException,
  RoleNotFoundException,
  SystemRoleImmutableException,
  UnknownPermissionException,
} from '../../../../common/exceptions';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    name: 'sales',
    isSystem: false,
    permissions: [],
    users: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Role;
}

function makeService(
  rolesRepo: Record<string, jest.Mock>,
  usersRepo: Record<string, jest.Mock> = {},
) {
  return new RolesService(rolesRepo as never, usersRepo as never);
}

describe('RolesService.create', () => {
  it('rejects unknown permission codes', async () => {
    const service = makeService({ findByName: jest.fn().mockResolvedValue(null) });

    await expect(
      service.create({ name: 'sales', permissions: ['not:a:real:permission'] }),
    ).rejects.toThrow(UnknownPermissionException);
  });

  it('rejects a duplicate name', async () => {
    const rolesRepo = { findByName: jest.fn().mockResolvedValue(makeRole()) };
    const service = makeService(rolesRepo);

    await expect(
      service.create({ name: 'sales', permissions: ['leads:read'] }),
    ).rejects.toThrow(RoleNameConflictException);
  });

  it('creates the role and stores its permission set', async () => {
    const created = makeRole({ id: 7 });
    const rolesRepo = {
      findByName: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(created),
      replacePermissions: jest.fn(),
      findById: jest.fn().mockResolvedValue(created),
    };
    const service = makeService(rolesRepo);

    await service.create({ name: 'sales', permissions: ['leads:read', 'leads:write'] });

    expect(rolesRepo.replacePermissions).toHaveBeenCalledWith(7, [
      'leads:read',
      'leads:write',
    ]);
  });
});

describe('RolesService.update', () => {
  it('throws for an unknown role', async () => {
    const service = makeService({ findById: jest.fn().mockResolvedValue(null) });

    await expect(service.update(1, { name: 'x' })).rejects.toThrow(RoleNotFoundException);
  });

  it('blocks renaming a system role', async () => {
    const systemRole = makeRole({ isSystem: true, name: 'admin' });
    const rolesRepo = { findById: jest.fn().mockResolvedValue(systemRole) };
    const service = makeService(rolesRepo);

    await expect(service.update(1, { name: 'superadmin' })).rejects.toThrow(
      SystemRoleImmutableException,
    );
  });

  it('allows editing a system role permission set, just not its name', async () => {
    const systemRole = makeRole({ isSystem: true, name: 'member' });
    const rolesRepo = {
      findById: jest.fn().mockResolvedValue(systemRole),
      save: jest.fn().mockResolvedValue(systemRole),
      replacePermissions: jest.fn(),
    };
    const service = makeService(rolesRepo);

    await service.update(1, { permissions: ['leads:read'] });

    expect(rolesRepo.replacePermissions).toHaveBeenCalledWith(1, ['leads:read']);
  });

  it('rejects unknown permissions on update', async () => {
    const role = makeRole();
    const rolesRepo = {
      findById: jest.fn().mockResolvedValue(role),
      save: jest.fn().mockResolvedValue(role),
    };
    const service = makeService(rolesRepo);

    await expect(
      service.update(1, { permissions: ['bogus:permission'] }),
    ).rejects.toThrow(UnknownPermissionException);
  });
});

describe('RolesService.delete', () => {
  it('blocks deleting a system role', async () => {
    const rolesRepo = {
      findById: jest.fn().mockResolvedValue(makeRole({ isSystem: true })),
    };
    const service = makeService(rolesRepo);

    await expect(service.delete(1)).rejects.toThrow(SystemRoleImmutableException);
  });

  it('blocks deleting a role that still has users assigned', async () => {
    const rolesRepo = { findById: jest.fn().mockResolvedValue(makeRole({ id: 1 })) };
    const usersRepo = { countByRoleId: jest.fn().mockResolvedValue(3) };
    const service = makeService(rolesRepo, usersRepo);

    await expect(service.delete(1)).rejects.toThrow(RoleInUseException);
  });

  it('deletes a custom, unassigned role', async () => {
    const rolesRepo = {
      findById: jest.fn().mockResolvedValue(makeRole({ id: 1 })),
      delete: jest.fn(),
    };
    const usersRepo = { countByRoleId: jest.fn().mockResolvedValue(0) };
    const service = makeService(rolesRepo, usersRepo);

    await service.delete(1);

    expect(rolesRepo.delete).toHaveBeenCalledWith(1);
  });
});
