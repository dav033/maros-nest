import { Injectable } from '@nestjs/common';
import { User } from '../../../../entities/user.entity';
import { Role } from '../../../../entities/role.entity';
import { UsersService } from '../users.service';

@Injectable()
export class UserMapper {
  constructor(private readonly usersService: UsersService) {}

  toUserDto(entity: User) {
    const pendingInvitation = (entity.invitations ?? []).find(
      (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
    );

    return {
      id: entity.id,
      email: entity.email,
      name: entity.name ?? null,
      picture: entity.picture ?? null,
      isActive: entity.isActive,
      userType: entity.userType,
      status: entity.status,
      scopedCompanyId: entity.scopedCompanyId ?? null,
      scopedContactId: entity.scopedContactId ?? null,
      // Only while the invitation is outstanding; an accepted one is history.
      invitationExpiresAt:
        entity.status === 'invited' ? (pendingInvitation?.expiresAt ?? null) : null,
      lastLoginAt: entity.lastLoginAt ?? null,
      createdAt: entity.createdAt,
      role: entity.role
        ? {
            id: entity.role.id,
            name: entity.role.name,
            isSystem: entity.role.isSystem,
          }
        : null,
    };
  }

  toRoleDto(entity: Role) {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description ?? null,
      isSystem: entity.isSystem,
      // Resolved rather than read straight from the join table, so the admin
      // role reports the full catalog it actually holds.
      permissions: this.usersService.effectivePermissions(entity),
    };
  }
}
