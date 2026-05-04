import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];
    const queryToken = this.readQueryToken(request);

    let token: string | null = null;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header (or token query param)');
    }

    const expectedToken = this.configService.get<string>('MCP_TOKEN');

    if (!expectedToken) {
      throw new UnauthorizedException('MCP_TOKEN is not configured');
    }

    if (token !== expectedToken) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }

  private readQueryToken(request: Request): string | null {
    const token = request.query.token;
    if (typeof token === 'string' && token.trim().length > 0) return token;
    if (Array.isArray(token) && typeof token[0] === 'string' && token[0].trim().length > 0)
      return token[0];
    return null;
  }
}
