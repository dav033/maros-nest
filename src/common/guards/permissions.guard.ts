import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_EXTERNAL_KEY } from '../decorators/allow-external.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { Permission } from '../auth/permissions';
import type { RequestWithUser } from '../auth/authenticated-user';

/**
 * Runs after SessionAuthGuard, which is what puts `request.user` (and its
 * effective permissions) in place.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // Para el personal de Maros, una ruta sin decorador sólo pide sesión válida.
    // Para alguien de fuera esa regla es al revés: se le cierra por defecto, y
    // sólo pasa por donde diga @AllowExternal. El motivo es que una ruta sin
    // permisos no es una ruta inofensiva, es una que nadie decoró —
    // /users/directory entregaba nombre y correo de todo el personal por eso—, y
    // mientras no exista el alcance por filas no hay manera de recortar una
    // lista a lo que le toca a ese externo.
    if (request.user?.userType === 'external') {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_EXTERNAL_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException(
          'This endpoint is not available to external users',
        );
      }
    }

    // No decorator: a valid session is enough.
    if (!required || required.length === 0) return true;

    const granted = new Set(request.user?.permissions ?? []);

    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
