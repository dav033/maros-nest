import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Role } from './role.entity';

/**
 * Join table between a role and the permission codes it grants.
 *
 * `permission` holds a code from the PERMISSIONS catalog. It is a plain string
 * rather than an FK because the catalog lives in code — see
 * `src/common/auth/permissions.ts`.
 */
@Entity('role_permissions')
export class RolePermission {
  @PrimaryColumn({ name: 'role_id', type: 'int' })
  roleId: number;

  @PrimaryColumn({ length: 64 })
  permission: string;

  @ManyToOne(() => Role, (role) => role.permissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
