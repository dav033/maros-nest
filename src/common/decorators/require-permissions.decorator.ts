import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../auth/permissions';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Requires the caller's role to grant every listed permission (AND, not OR).
 *
 * Applies to a whole controller or to a single route; a route-level decorator
 * replaces the controller-level one rather than adding to it. Routes with no
 * decorator only require a valid session.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
