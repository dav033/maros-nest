import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { ALLOW_EXTERNAL_KEY } from '../decorators/allow-external.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { Permission } from '../auth/permissions';

type Metadata = {
  [IS_PUBLIC_KEY]?: boolean;
  [REQUIRED_PERMISSIONS_KEY]?: Permission[];
  [ALLOW_EXTERNAL_KEY]?: boolean;
};

function makeContext(
  permissions: Permission[] | undefined,
  userType: 'internal' | 'external' = 'internal',
) {
  const request = permissions ? { user: { permissions, userType } } : {};
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function makeGuard(metadata: Metadata) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      (metadata as Record<string, unknown>)[key],
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('allows public routes without looking at the user', () => {
    const guard = makeGuard({ [IS_PUBLIC_KEY]: true });

    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows routes with no @RequirePermissions to any authenticated caller', () => {
    const guard = makeGuard({});

    expect(guard.canActivate(makeContext([]))).toBe(true);
  });

  it('allows when the user holds the required permission', () => {
    const guard = makeGuard({
      [REQUIRED_PERMISSIONS_KEY]: ['leads:read'],
    });

    expect(guard.canActivate(makeContext(['leads:read']))).toBe(true);
  });

  it('denies when the user is missing the required permission', () => {
    const guard = makeGuard({
      [REQUIRED_PERMISSIONS_KEY]: ['finance:read'],
    });

    expect(() => guard.canActivate(makeContext(['leads:read']))).toThrow(
      ForbiddenException,
    );
  });

  it('requires every listed permission, not just one (AND semantics)', () => {
    const guard = makeGuard({
      [REQUIRED_PERMISSIONS_KEY]: ['leads:read', 'finance:read'],
    });

    expect(() => guard.canActivate(makeContext(['leads:read']))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the request has no resolved user at all', () => {
    const guard = makeGuard({
      [REQUIRED_PERMISSIONS_KEY]: ['leads:read'],
    });

    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  /**
   * Una ruta sin @RequirePermissions no es una ruta inofensiva: es una que nadie
   * decoró. Para el personal eso está bien, pero a un invitado de fuera le entregaba
   * cualquiera de ellas — /users/directory, con el nombre y el correo de todo el
   * equipo, entre otras.
   */
  describe('usuarios externos', () => {
    it('cierra una ruta sin decorar a un externo', () => {
      const guard = makeGuard({});

      expect(() => guard.canActivate(makeContext([], 'external'))).toThrow(
        ForbiddenException,
      );
    });

    it('la abre cuando la ruta dice @AllowExternal', () => {
      const guard = makeGuard({ [ALLOW_EXTERNAL_KEY]: true });

      expect(guard.canActivate(makeContext([], 'external'))).toBe(true);
    });

    it('no le sirve @AllowExternal si además faltan permisos', () => {
      const guard = makeGuard({
        [ALLOW_EXTERNAL_KEY]: true,
        [REQUIRED_PERMISSIONS_KEY]: ['leads:read'],
      });

      expect(() => guard.canActivate(makeContext([], 'external'))).toThrow(
        ForbiddenException,
      );
    });

    it('no toca al personal: la misma ruta sin decorar sigue abierta', () => {
      const guard = makeGuard({});

      expect(guard.canActivate(makeContext([], 'internal'))).toBe(true);
    });
  });
});
