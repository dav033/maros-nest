import type { Request } from 'express';
import type { Permission } from './permissions';

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
}

export type RequestWithUser = Request & { user?: AuthenticatedUser };
