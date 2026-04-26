import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const expectedToken = this.configService.get<string>('MCP_TOKEN');

    if (!expectedToken) {
      throw new UnauthorizedException('MCP_TOKEN is not configured');
    }

    if (token !== expectedToken) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }
}
