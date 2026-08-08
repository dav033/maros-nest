import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Shared-secret auth for machine callers that cannot carry a session cookie
 * (lead intake from external automations / web forms).
 *
 * Routes using this must also be marked @Public() so the session guard lets
 * them through — @Public() alone would leave them wide open.
 */
@Injectable()
export class IntakeTokenGuard implements CanActivate {
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

    const expected = this.configService.get<string>('LEAD_INTAKE_TOKEN');
    if (!expected) {
      throw new UnauthorizedException('LEAD_INTAKE_TOKEN is not configured');
    }

    if (!this.tokensMatch(token, expected)) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }

  private tokensMatch(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
