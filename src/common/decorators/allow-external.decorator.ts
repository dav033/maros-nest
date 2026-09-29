import { SetMetadata } from '@nestjs/common';

export const ALLOW_EXTERNAL_KEY = 'allowExternal';

/**
 * Deja pasar a un usuario externo por esta ruta.
 *
 * Para el resto del CRM la regla por defecto es al revés: una ruta sin
 * `@RequirePermissions` sólo exige sesión válida, lo que alcanzaba para que un
 * invitado de fuera leyera cualquier endpoint que nadie se acordó de decorar —
 * el directorio del personal, por ejemplo. PermissionsGuard ahora cierra todo
 * eso para los externos, y esta marca es la única forma de abrir una ruta.
 *
 * Se pone sólo donde lo que se devuelve es del propio usuario (su perfil, sus
 * preferencias, sus notificaciones), nunca sobre datos de la empresa: el
 * alcance por filas no existe todavía, así que no hay forma de recortar una
 * lista a lo que le corresponde a ese externo.
 */
export const AllowExternal = () => SetMetadata(ALLOW_EXTERNAL_KEY, true);
