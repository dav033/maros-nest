import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * CUIDADO con el token en query string.
 *
 * Este guard acepta el token por `?token=` además de por cabecera, porque algunos
 * clientes MCP sólo saben pasarlo en la URL. Las query strings acaban en sitios
 * donde una cabecera no: logs de acceso del proxy, historial del navegador,
 * referers.
 *
 * Eso era un riesgo moderado cuando el MCP sólo leía y escribía datos de negocio.
 * Dejó de serlo: `update_user` y `create_role` permiten darse el rol admin, así
 * que MCP_TOKEN vale hoy lo mismo que la contraseña de un administrador. Si hay
 * que elegir, pásalo siempre por la cabecera Authorization y considera quitar
 * `readQueryToken` cuando ningún cliente lo necesite.
 */
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

    if (!this.tokensMatch(token, expectedToken)) {
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

  private readQueryToken(request: Request): string | null {
    const token = request.query.token;
    if (typeof token === 'string' && token.trim().length > 0) return token;
    if (Array.isArray(token) && typeof token[0] === 'string' && token[0].trim().length > 0)
      return token[0];
    return null;
  }
}
