import { HttpStatus } from '@nestjs/common';
import { ResourceNotFoundException } from '../resource-not-found.exception';
import { BusinessException } from '../business.exception';
import { BaseException } from '../base.exception';

export class UserNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`User not found with id: ${id}`);
  }
}

export class RoleNotFoundException extends ResourceNotFoundException {
  constructor(identifier: number | string) {
    super(`Role not found: ${identifier}`);
  }
}

export class RoleNameConflictException extends BaseException {
  constructor(name: string) {
    super(
      `A role named "${name}" already exists`,
      HttpStatus.CONFLICT,
      'ROLE_NAME_CONFLICT',
    );
  }
}

export class SystemRoleImmutableException extends BusinessException {
  constructor(name: string) {
    super(
      `The "${name}" role is built in and cannot be renamed or deleted`,
      'SYSTEM_ROLE_IMMUTABLE',
    );
  }
}

export class RoleInUseException extends BusinessException {
  constructor(name: string, userCount: number) {
    super(
      `Cannot delete role "${name}": ${userCount} user(s) are still assigned to it`,
      'ROLE_IN_USE',
    );
  }
}

export class UnknownPermissionException extends BusinessException {
  constructor(permissions: string[]) {
    super(
      `Unknown permission code(s): ${permissions.join(', ')}`,
      'UNKNOWN_PERMISSION',
    );
  }
}

/**
 * Blocks the two ways an admin could lock everyone out of user administration:
 * demoting/disabling themselves, or removing the only remaining admin.
 */
export class SelfModificationException extends BusinessException {
  constructor() {
    super(
      'You cannot change your own role or deactivate your own account',
      'SELF_MODIFICATION_FORBIDDEN',
    );
  }
}

export class LastAdminException extends BusinessException {
  constructor() {
    super(
      'This is the last active admin. Promote another user to admin first',
      'LAST_ADMIN',
    );
  }
}

export class UserAlreadyExistsException extends BaseException {
  constructor(email: string) {
    super(
      `A user with the email ${email} already exists`,
      HttpStatus.CONFLICT,
      'USER_ALREADY_EXISTS',
    );
  }
}

/** Resending only makes sense while the invitation is still outstanding. */
export class UserNotInvitedException extends BusinessException {
  constructor(email: string) {
    super(
      `${email} has no pending invitation`,
      'USER_NOT_INVITED',
    );
  }
}

export class UserInactiveException extends BaseException {
  constructor(email: string) {
    super(
      `Account ${email} has been deactivated`,
      HttpStatus.FORBIDDEN,
      'USER_INACTIVE',
    );
  }
}

/**
 * Un usuario externo es alguien de fuera de Maros: sólo puede entrar con un rol sin
 * permisos. El formulario ofrece los dos campos por separado, así que nada impedía
 * invitar a alguien de fuera como admin; esta regla lo corta en el servidor.
 */
export class ExternalUserRoleException extends BaseException {
  constructor(roleName: string) {
    super(
      `An external user cannot be invited with the role "${roleName}": it grants permissions inside the CRM`,
      HttpStatus.BAD_REQUEST,
      'EXTERNAL_USER_ROLE_NOT_ALLOWED',
    );
  }
}

export const UserExceptions = {
  UserNotFoundException,
  RoleNotFoundException,
  RoleNameConflictException,
  SystemRoleImmutableException,
  RoleInUseException,
  UnknownPermissionException,
  SelfModificationException,
  LastAdminException,
  UserAlreadyExistsException,
  UserNotInvitedException,
  UserInactiveException,
  ExternalUserRoleException,
};
