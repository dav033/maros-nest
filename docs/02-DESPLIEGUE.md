# Orden de despliegue — rama `feat/qbo-report-invitaciones-2026-09-27`

Fecha: 2026-09-27

Este documento existe por una razón concreta: **si se despliega en el orden equivocado, los usuarios externos se quedan fuera y el fallo es silencioso para quien lo despliega.** El personal de `@marosconstruction.com` seguirá entrando con normalidad, así que nadie del equipo notará nada — solo el cliente al otro lado.

---

## 0. El riesgo, en una frase

El callback de Google **falla cerrado**. Es deliberado: una caída del backend nunca debe ampliar el acceso. La consecuencia es que **cualquier pieza que falte se comporta igual que "no estás invitado"**: sin la variable de entorno, sin la tabla, o sin el backend desplegado, todo externo recibe `/login?error=unavailable` o `?error=domain`.

El dominio de Workspace se comprueba **antes y por separado**, precisamente para que el equipo interno no se quede fuera si algo de esto falla. Eso salva al equipo y oculta el problema.

---

## 1. Antes de tocar nada — verificaciones

| Comprobación | Por qué | Si falla |
|---|---|---|
| `QB_ENCRYPTION_KEY` está puesta en producción | Si no está, `TokenCryptoService` hace *passthrough en texto plano* sin fallar al arrancar: los tokens de QuickBooks quedan **sin cifrar** en la base de datos y nada lo advierte | Ponla antes de cualquier otra cosa. No es de esta entrega, pero se descubre ahora |
| `TASK_APP_URL` = `https://app.marosconstruction.com` | Es de donde sale el enlace del correo de invitación. `FRONTEND_URL` apunta al sitio de marketing y **no tiene `/login`** | Las invitaciones llegan a una página inexistente |
| SMTP (`MAIL_SMTP_*`, `MAIL_FROM`) operativo | `MailService` valida la configuración **al enviar**, no al arrancar. Y la invitación, a diferencia del resto de envíos del sistema, **falla en voz alta** a propósito | Crear una invitación devolverá error en vez de crear un usuario al que nadie avisó |
| Anota qué usuarios tienen hoy `is_active = false` | La columna `status` se añade con backfill, pero conviene poder comparar | — |

---

## 2. El orden. No se puede alterar

### Paso 1 — Variables de entorno, en **las dos** aplicaciones

`AUTH_INVITATION_CHECK_TOKEN` debe existir **con el mismo valor** en `maros-nest` y en `maros-next`.

```
openssl rand -hex 32
```

> **El nombre es el mismo en las dos.** Los comentarios de `.env.example` decían `INVITATION_CHECK_TOKEN` (sin prefijo), que no lo lee nadie; ya está corregido, pero si alguien copió el nombre viejo, el frontend leerá `undefined`, `checkInvitation` devolverá `null` y **todo externo quedará denegado**.

Ponlas antes de desplegar nada. Una variable de más no rompe nada; una de menos, sí.

### Paso 2 — El esquema

```sql
\i db/add-user-invitations.sql
```

Idempotente y se puede volver a ejecutar. Hace tres cosas que conviene entender:

1. Añade a `users`: `user_type`, `status`, `scoped_company_id`, `scoped_contact_id`, `invited_by_id`.
2. **Rellena `status`**: `UPDATE users SET status = 'disabled' WHERE is_active = FALSE AND status = 'active'`. Sin eso, el `DEFAULT 'active'` solo aplica a filas nuevas y toda cuenta ya desactivada aparecería como activa en la lista de admin — mintiendo sobre quién puede entrar.
3. Siembra los roles `client` y **`Solo task`**. Este último ya existe en tu producción, pero **no estaba versionado en ningún archivo**, aunque `AUTH_DEFAULT_ROLE` apunta a él. En tu base el `INSERT` no hará nada; en una base nueva, evita que todo usuario nuevo quede sin rol y sin permisos con solo un warning en el log.

Después: `SELECT status, count(*) FROM users GROUP BY status;` y compara con lo que anotaste.

### Paso 3 — Backend

Desplegar `maros-nest`. Aparecen `POST /users/invite`, `POST /auth/invitations/check`, el reporte por proyecto y las rutas nuevas de importación.

Comprobación: `GET /api/` responde, y `POST /api/auth/invitations/check` con el bearer correcto y un correo cualquiera devuelve `{ allowed: false }` en vez de 401.

### Paso 4 — **Dar de alta a los dos externos actuales. Antes del frontend.**

Hoy hay dos direcciones de Gmail escritas a mano en `maros-next/src/app/api/auth/google/callback/route.ts`. Una es la tuya. **El paso 5 borra esa constante.** Si el frontend sale antes de que esas dos personas existan como usuarios invitados y activos, **pierden el acceso en el momento del deploy.**

Para cada una, con una sesión de admin:

```
POST /api/users/invite
{ "email": "<la dirección>", "roleId": <el rol que le corresponda>, "userType": "client" }
```

Verifica antes de seguir:

```sql
SELECT email, user_type, status, is_active FROM users WHERE email IN ('…','…');
```

Las dos deben salir con `status` en `invited` o `active` y `is_active = true`.

### Paso 5 — Frontend

Desplegar `maros-next`. A partir de aquí la allowlist vive en la base de datos.

---

## 3. Verificación posterior

1. **Interno**: entrar con una cuenta `@marosconstruction.com`. Debe funcionar igual que siempre. Si esto falla, revertir el paso 5 inmediatamente.
2. **Externo existente**: que una de las dos direcciones del paso 4 entre.
3. **Externo nuevo**: invitar a una dirección de prueba, comprobar que **llega el correo** y que el enlace apunta a `app.marosconstruction.com`, no a `marosconstruction.com`.
4. **Desconocido**: intentar entrar con una dirección que no está invitada → debe denegar.
5. **Reporte**: abrir un proyecto **con** `qboCustomerId` y pulsar "Llévame al reporte"; cambiar entre Cash y Accrual y confirmar que las cifras cambian. Después abrir uno **sin** vincular y confirmar que el botón está desactivado con su explicación, no con un error genérico.

---

## 4. Cómo se ve cuando está roto

| Síntoma | Causa casi segura |
|---|---|
| Interno entra, externo recibe `?error=unavailable` | `AUTH_INVITATION_CHECK_TOKEN` no coincide entre las dos apps, o el backend no responde |
| Interno entra, externo recibe `?error=domain` | El correo no existe como usuario, o existe con `is_active = false` |
| Externo recibe `?error=invitation` | La invitación caducó o fue revocada. Es el caso **correcto** y distinguible a propósito |
| Nadie recibe el correo de invitación | SMTP. `MailService` valida al enviar, mira los logs del backend |
| El correo llega pero el enlace da 404 | `TASK_APP_URL` no está puesta y cayó al valor por defecto |
| Un usuario desactivado aparece como activo | El backfill de `status` no se ejecutó |

---

## 5. Vuelta atrás

**Frontend (paso 5)**: revertir es seguro e inmediato. Vuelve la constante hardcodeada, así que las dos direcciones de Gmail recuperan el acceso — pero **cualquier cliente invitado después lo pierde** hasta que se vuelva a desplegar.

**Backend (paso 3)**: revertir es seguro mientras el frontend viejo esté puesto. Con el frontend nuevo, revertir el backend deja sin responder a `/auth/invitations/check` y **todo externo queda denegado** (falla cerrado, por diseño).

**Esquema (paso 2)**: no hace falta revertirlo. Las columnas nuevas tienen valores por defecto y el código antiguo las ignora.

> **Regla:** el frontend nunca puede ir por delante del backend, y el backend nunca puede retroceder por detrás del frontend.

---

## 6. Lo que este despliegue **no** incluye

- **El alcance por filas no se aplica.** `scoped_company_id` y `scoped_contact_id` se guardan y se exponen, pero **ningún módulo filtra todavía por ellos**. Un usuario externo con rol `client` ve lo que su rol le permita, en toda la empresa. Decisión consciente: aplicarlo toca todos los módulos y merece su propia entrega y su propia revisión. **No invites a un cliente esperando que solo vea su obra hasta que eso esté hecho.**
- **La interfaz de importación de QuickBooks.** El backend de detección de colisiones, lote y desvincular está construido, pero las tres rutas todavía no tienen pantalla.
- **El rediseño.** Va en su propio trabajo, aún sin commitear cuando se escribe esto.
- **Nada de Flutter.** Ver `plans/01-FLUTTER-2026-09-27.md`.

---

## 7. Anotaciones para después del despliegue

- `buildJobIndex` cachea el índice de jobs **5 minutos** por realm. Tras importar o desvincular, los informes pueden tardar hasta ese tiempo en reflejar el vínculo nuevo.
- Los reportes de proveedor (`AgedPayables`, `VendorExpenses`, `VendorBalanceDetail`) y `BalanceSheet` reciben el filtro `customer`, pero la API de Intuit **puede ignorarlo**: comprobar contra el realm real antes de que nadie tome una decisión con esas cifras.
- `resolveDefaultRealmId()` es literalmente `find({ take: 1 })`. Correcto con una sola empresa conectada; silenciosamente incorrecto con dos.
