import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { RequestWithUser } from '../auth/authenticated-user';
import { runWithRequestScope } from '../auth/request-scope';

/**
 * Pone el ambito del usuario a disposicion de todo lo que corra durante la
 * peticion, para que una consulta pueda filtrar por tipo de lead sin que el
 * usuario viaje como parametro por los veintisiete metodos de lectura.
 *
 * Es un interceptor y no un middleware porque el middleware corre antes que los
 * guards: ahi `request.user` todavia no existe, ya que lo resuelve
 * SessionAuthGuard. Los interceptores corren despues, asi que aqui ya esta.
 *
 * En una ruta @Public no hay usuario y el ambito queda sin restriccion, que es
 * lo que corresponde: una ruta publica no tiene a quien restringir.
 */
@Injectable()
export class RequestScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const scopedLeadTypes = request?.user?.scopedLeadTypes ?? null;
    return runWithRequestScope({ scopedLeadTypes }, () => next.handle());
  }
}
