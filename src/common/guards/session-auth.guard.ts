import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
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

    const secret = this.configService.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new UnauthorizedException('AUTH_SECRET is not configured');
    }

    let email: string;
    let name: string | undefined;
    let picture: string | undefined;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      if (typeof payload.email !== 'string') {
        throw new Error('Session token has no email claim');
      }
      email = payload.email;
      name = typeof payload.name === 'string' ? payload.name : undefined;
      picture = typeof payload.picture === 'string' ? payload.picture : undefined;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Throws UserInactiveException (403) for deactivated accounts; provisions
    // the row on a verified identity's first request.
    request.user = await this.usersService.resolveForRequest({
      email,
      name,
      picture,
    });

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
