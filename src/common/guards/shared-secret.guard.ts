import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Type,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Builds a guard that authenticates a machine caller by a shared secret, read from the
 * environment variable it is given.
 *
 * Each caller keeps its own variable and therefore its own guard: the secrets are not
 * interchangeable, and leaking one must not open the other's route. The check itself is
 * the same every time, so it lives here once.
 *
 * Routes using one of these must also be marked @Public() so the session guard lets
 * them through — @Public() alone would leave them wide open.
 */
export function sharedSecretGuard(envVar: string): Type<CanActivate> {
  @Injectable()
  class SharedSecretGuard implements CanActivate {
    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest<Request>();
      const authHeader = request.headers['authorization'];

      const token =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : null;

      if (!token) {
        throw new UnauthorizedException('Missing Authorization: Bearer <token>');
      }

      const expected = this.configService.get<string>(envVar);
      if (!expected) {
        throw new UnauthorizedException(`${envVar} is not configured`);
      }

      if (!tokensMatch(token, expected)) {
        throw new UnauthorizedException('Invalid token');
      }

      return true;
    }
  }

  return SharedSecretGuard;
}

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
