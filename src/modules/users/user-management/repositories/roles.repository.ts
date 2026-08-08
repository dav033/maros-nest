import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../../../entities/role.entity';
import { RolePermission } from '../../../../entities/role-permission.entity';

@Injectable()
export class RolesRepository {
  constructor(
    @InjectRepository(Role)
    private readonly repo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly permissionRepo: Repository<RolePermission>,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.repo.find({
      relations: { permissions: true },
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<Role | null> {
    return this.repo.findOne({ where: { id }, relations: { permissions: true } });
  }

  async findByName(name: string): Promise<Role | null> {
    return this.repo
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(role.name) = LOWER(:name)', { name })
      .getOne();
  }

  async save(role: Role): Promise<Role> {
    return this.repo.save(role);
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /** Replaces a role's permission set wholesale. */
  async replacePermissions(
    roleId: number,
    permissions: string[],
  ): Promise<void> {
    await this.permissionRepo.delete({ roleId });
    if (permissions.length === 0) return;
    await this.permissionRepo.insert(
      permissions.map((permission) => ({ roleId, permission })),
    );
  }
}
