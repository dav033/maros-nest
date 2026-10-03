import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import { isLocalDevAuthBypassEnabled } from '../auth/dev-auth';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS } from '../auth/permissions';
import type { RequestWithUser } from '../auth/authenticated-user';
import { UsersService } from '../../modules/users/user-management/users.service';

const SESSION_COOKIE = 'maros_session';

/**
 * Verifies the session cookie minted by the Next.js OAuth callback, then
 * resolves that identity against the users table.
 *
 * The JWT proves *who* you are and nothing more — permissions deliberately do
 * not travel in the token. Resolving them per request is what makes a role
 * change or a deactivation take effect immediately instead of waiting out the
 * token's 30-day lifetime.
 *
 * That resolution is now served from a short-lived in-memory cache
 * (RESOLVED_USER_TTL_MS, 30 s) because it cost a full round trip to a database
 * 130 ms away on *every* authenticated request — roughly 4.6 of them per page
 * render. The immediacy above is preserved, and is not merely traded for the
 * TTL: UsersService.update (role, isActive), RolesService.update (a role's
 * permission set) and UserInvitationsService.revoke all drop the affected
 * entries explicitly, so those changes still bite on the very next request.
 * The 30 s window is the backstop for a mutation path that forgets to
 * invalidate, not the intended mechanism — a new path that changes a user's
 * permissions must call UsersService.invalidateResolvedUser.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.readSessionCookie(request);
    if (!token) {
      throw new UnauthorizedException('Missing session cookie');
    }

    let email: string | undefined;
    let name: string | undefined;
    let picture: string | undefined;

    const authSecret = this.configService.get<string>('AUTH_SECRET');
    const devSecret = this.configService.get<string>('DEV_AUTH_SECRET');
    const isDevBypassEnabled = isLocalDevAuthBypassEnabled({
      nodeEnv: process.env.NODE_ENV,
      enabled: this.configService.get<string>('DEV_AUTH_BYPASS'),
      devSecret,
      authSecret,
    });
    let devSession = false;

    if (isDevBypassEnabled && devSecret) {
      try {
        const { payload } = await jwtVerify(
          token,
          new TextEncoder().encode(devSecret),
        );
        if (payload.devSession === true && typeof payload.email === 'string') {
          email = payload.email;
          name = typeof payload.name === 'string' ? payload.name : undefined;
          picture =
            typeof payload.picture === 'string' ? payload.picture : undefined;
          devSession = true;
        }
      } catch {
        // Fall through to the regular session validator.
      }
    }

    if (!devSession) {
      if (!authSecret) {
        throw new UnauthorizedException('AUTH_SECRET is not configured');
      }

      try {
        const { payload } = await jwtVerify(
          token,
          new TextEncoder().encode(authSecret),
        );
        if (typeof payload.email !== 'string') {
          throw new Error('Session token has no email claim');
        }
        email = payload.email;
        name = typeof payload.name === 'string' ? payload.name : undefined;
        picture =
          typeof payload.picture === 'string' ? payload.picture : undefined;
      } catch {
        throw new UnauthorizedException('Invalid or expired session');
      }
    }

    if (!email) {
      throw new UnauthorizedException('Session token has no email claim');
    }

    if (devSession) {
      const devActorId = Number(
        this.configService.get<string>('DEV_AUTH_USER_ID'),
      );
      if (!Number.isInteger(devActorId) || devActorId <= 0) {
        throw new UnauthorizedException(
          'DEV_AUTH_USER_ID must reference an existing user in local development',
        );
      }
      const existingActorId =
        await this.usersService.findExistingDevActor(devActorId);
      if (!existingActorId) {
        throw new UnauthorizedException(
          'DEV_AUTH_USER_ID does not match an existing user',
        );
      }
      request.user = {
        id: existingActorId,
        email,
        name: name ?? 'Local Developer',
        picture: picture ?? null,
        role: { id: 0, name: 'development' },
        permissions: [...PERMISSIONS],
        userType: 'internal',
        // El actor de desarrollo no esta restringido a ningun tipo.
        scopedLeadTypes: null,
      };
    } else {
      // Throws UserInactiveException (403) for deactivated accounts; provisions
      // the row on a verified identity's first request.
      request.user = await this.usersService.resolveForRequest({
        email,
        name,
        picture,
      });
    }

    return true;
  }

  private readSessionCookie(request: RequestWithUser): string | null {
    const header = request.headers['cookie'];
    if (!header) return null;

    for (const part of header.split(';')) {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) continue;
      const name = part.slice(0, separatorIndex).trim();
      if (name === SESSION_COOKIE) {
        return decodeURIComponent(part.slice(separatorIndex + 1).trim());
      }
    }
    return null;
  }
}
