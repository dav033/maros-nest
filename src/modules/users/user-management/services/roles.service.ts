import { Injectable } from '@nestjs/common';
import { Role } from '../../../../entities/role.entity';
import {
  RoleInUseException,
  RoleNameConflictException,
  RoleNotFoundException,
  SystemRoleImmutableException,
  UnknownPermissionException,
} from '../../../../common/exceptions';
import { isPermission } from '../../../../common/auth/permissions';
import { RolesRepository } from '../repositories/roles.repository';
import { UsersRepository } from '../repositories/users.repository';

@Injectable()
export class RolesService {
  constructor(
    private readonly rolesRepo: RolesRepository,
    private readonly usersRepo: UsersRepository,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.rolesRepo.findAll();
  }

  async findById(id: number): Promise<Role> {
    const role = await this.rolesRepo.findById(id);
    if (!role) throw new RoleNotFoundException(id);
    return role;
  }

  async create(input: {
    name: string;
    description?: string;
    permissions: string[];
  }): Promise<Role> {
    this.assertKnownPermissions(input.permissions);
    await this.assertNameAvailable(input.name);

    const role = new Role();
    role.name = input.name.trim();
    role.description = input.description?.trim();
    role.isSystem = false;

    const saved = await this.rolesRepo.save(role);
    await this.rolesRepo.replacePermissions(saved.id, input.permissions);
    return this.findById(saved.id);
  }

  async update(
    id: number,
    changes: { name?: string; description?: string; permissions?: string[] },
  ): Promise<Role> {
    const role = await this.findById(id);

    // System roles keep their identity, but their permission set stays
    // editable — except admin, whose permissions are resolved in code.
    if (role.isSystem && changes.name !== undefined && changes.name !== role.name) {
      throw new SystemRoleImmutableException(role.name);
    }

    if (changes.name !== undefined && changes.name !== role.name) {
      await this.assertNameAvailable(changes.name);
      role.name = changes.name.trim();
    }

    if (changes.description !== undefined) {
      role.description = changes.description.trim();
    }

    await this.rolesRepo.save(role);

    if (changes.permissions) {
      this.assertKnownPermissions(changes.permissions);
      await this.rolesRepo.replacePermissions(id, changes.permissions);
    }

    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const role = await this.findById(id);

    if (role.isSystem) {
      throw new SystemRoleImmutableException(role.name);
    }

    const userCount = await this.usersRepo.countByRoleId(id);
    if (userCount > 0) {
      throw new RoleInUseException(role.name, userCount);
    }

    await this.rolesRepo.delete(id);
  }

  private assertKnownPermissions(permissions: string[]): void {
    const unknown = permissions.filter((permission) => !isPermission(permission));
    if (unknown.length > 0) {
      throw new UnknownPermissionException(unknown);
    }
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.rolesRepo.findByName(name.trim());
    if (existing) {
      throw new RoleNameConflictException(name);
    }
  }
}
