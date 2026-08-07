import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { jwtVerify } from 'jose';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const SESSION_COOKIE = 'maros_session';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.readSessionCookie(request);
    if (!token) {
      throw new UnauthorizedException('Missing session cookie');
    }

    const secret = this.configService.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new UnauthorizedException('AUTH_SECRET is not configured');
    }

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      (request as Request & { user?: unknown }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  private readSessionCookie(request: Request): string | null {
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
