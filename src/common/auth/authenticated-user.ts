import type { Request } from 'express';
import type { UserType } from '../../entities/user.entity';
import type { Permission } from './permissions';
import type { LeadType } from '../enums/lead-type.enum';

/**
 * What SessionAuthGuard attaches to the request after resolving the JWT
 * identity against the database. `permissions` is the effective set for the
 * user's role, already expanded (the admin system role resolves to the whole
 * catalog).
 */
export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: { id: number; name: string } | null;
  permissions: Permission[];
  /**
   * 'external' es alguien de fuera de Maros. PermissionsGuard le cierra todo lo
   * que no esté marcado con @AllowExternal, incluidas las rutas sin permisos.
   */
  userType: UserType;
  /**
   * Los tipos de lead que puede ver. `null` es todos, que es lo que tiene quien
   * no esta restringido — y lo que tienen las seis cuentas de hoy.
   */
  scopedLeadTypes: LeadType[] | null;
}

export type RequestWithUser = Request & { user?: AuthenticatedUser };
