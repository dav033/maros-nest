# Plan maestro — Rediseño MARO + acceso externo + reporte QBO + móvil Flutter

Fecha: 2026-09-27
Alcance: `maros-nest/**`, `maros-next/**`, `maros-nest/db/*.sql`, nuevo `maros-flutter/` (fase posterior).

## Decisiones tomadas (confirmadas por David, 2026-09-27)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | "Llévame al reporte" | **Reporte crudo dentro de MAROS.** Llamar a la Reports API de QBO y pintar la respuesta tal cual, sin normalizar ni recalcular. Toggle Cash/Accrual. No depende de que el usuario tenga sesión en QuickBooks. |
| 2 | Acceso de usuarios externos | **Google OAuth restringido a invitados.** El admin pre-autoriza el correo; el invitado entra con su cuenta Google. Cero código de credenciales. |
| 3 | "Usa claude design" | **Sistema de diseño propio MARO.** Tokens, tipografía, superficies y componentes nuevos sobre shadcn/Tailwind v4. Guía de estilo primero, para aprobar antes de migrar pantallas. |

---

## 0. Punto de partida real (verificado, no supuesto)

### Producción
| Pieza | URL |
|---|---|
| Web pública (marketing) | `https://marosconstruction.com` |
| CRM | `https://app.marosconstruction.com` |
| API | `https://api.marosconstruction.com/api` |
| Frontend host | Netlify (`maros-app.netlify.app`), build webpack forzado |

### Stack
- **Backend** `maros-nest`: NestJS 11, TypeORM 0.3 (`synchronize: false`, DDL manual e idempotente en `maros-nest/db/*.sql`), Postgres, `jose` para JWT, `nodemailer` SMTP, `@modelcontextprotocol/sdk` (servidor MCP), `@nestjs/swagger`, S3, Google Calendar, ClickUp, Trello.
- **Frontend** `maros-next`: Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui, TanStack Query, TipTap, dnd-kit, Vitest, `eslint-plugin-boundaries`.

### Autenticación hoy
- Login **solo Google OAuth**. `maros-next/src/app/login/page.tsx:27-49` es un único enlace a `/api/auth/google`.
- El callback (`maros-next/src/app/api/auth/google/callback/route.ts`) verifica el `id_token` contra el JWKS de Google y exige:
  `email_verified === true` **Y** (`hd === 'marosconstruction.com'` **O** el correo está en `EXTERNAL_EMAIL_ALLOWLIST`).
- **`EXTERNAL_EMAIL_ALLOWLIST` está hardcodeado en el fuente** (líneas 15-18): dos direcciones de Gmail. Dar acceso a un cliente hoy = editar código + redesplegar. **Este es el punto exacto que hay que mover a base de datos.**
- Se emite cookie `maros_session` (JWT HS256, `AUTH_SECRET`, httpOnly, 30 días, dominio `.marosconstruction.com`).
- `maros-next/src/middleware.ts` protege todo salvo `/api/auth/*`, `/p/*` (links públicos de notas), `/about`, `/privacy-policy`.
- Backend: `SessionAuthGuard` global (`app.module.ts:88`) + `PermissionsGuard` (`:89`). El guard **no confía en el JWT para permisos**: en cada request relee el usuario de la BD (`UsersService.resolveForRequest`), así que desactivar a alguien surte efecto inmediato.
- `@Public()` + `IntakeTokenGuard` es el precedente de ruta pública con token.

### Usuarios y permisos hoy
- `users` (`user.entity.ts`): `id, email (único, minúsculas), name, picture, role_id (nullable), is_active, last_login_at, notification_preferences (jsonb)`. **Sin columna de contraseña. Sin ninguna relación a Company/Contact/Project.**
- `roles` + `role_permissions`. Catálogo de permisos **definido en código** (`maros-nest/src/common/auth/permissions.ts`): `dashboard:read`, `finance:read/write`, `leads:*`, `projects:*`, `contacts:*`, `companies:*`, `notes:*`, `tasks:*`, `reports:read`, `users:read/write`.
- Roles sembrados: `admin` (recibe el catálogo completo por código) y `member` (todo menos `users:*`).
- **No existe `POST /users`.** `UsersController` solo lista y hace `PATCH /users/:id` con `{roleId?, isActive?}`. Los usuarios se autoprovisionan en el primer login de Google.
- **No hay scoping por fila en ningún módulo.** La autorización es plana por permiso de módulo. El único precedente de acceso por fila es `note_page_shares` (sujeto usuario/rol → página), que sirve de modelo estructural.
- Riesgo detectado: `AUTH_DEFAULT_ROLE` por defecto es `'Solo task'`, que **no coincide** con los roles sembrados (`admin`, `member`). Si ese rol no existe en la BD, un usuario nuevo queda sin rol y sin permisos, solo con un warning en log (`users.service.ts:214-218`).

### Correo hoy
- `MailService` (`maros-nest/src/modules/mail/services/mail.service.ts`) con nodemailer SMTP. Solo transporte `smtp` implementado; valida configuración **al enviar**, no al arrancar.
- Layout HTML compartido reutilizable: `maros-nest/src/modules/mail/templates/email-layout.ts` → `renderEmailLayout({preheader, heading, bodyHtml, ctaLabel, ctaUrl})`, tabla Outlook-safe, botón CTA único, helper `escapeHtml()`.
- Patrón de servicio de notificación por feature a copiar: `invoice-scan-notifications.service.ts` + `invoice-scan-email-templates.ts`.
- **Ojo:** todos los call-sites actuales se tragan los fallos de envío (solo log). Para la invitación esto debe ser **deliberadamente distinto**: si el correo no sale, el admin tiene que enterarse.

### Generación segura de tokens (ya existe, reutilizable)
`maros-nest/src/modules/notes/note-sharing/services/share-token.util.ts`:
- `generateShareToken()` → 32 bytes aleatorios en base64url; **solo se persiste el SHA-256** (`hashShareToken`), el token crudo se devuelve una vez.
- Forma de almacenamiento a imitar: `note_page_links` (`tokenHash`, `tokenHint`, `expiresAt`, `revokedAt`, `createdById`).

### Proyectos hoy
- `Project`: `id, project_progress_status, quickbooks, qbo_customer_id (único parcial), overview, notes (jsonb), attachments (jsonb), lead_id (1:1)`. El cliente se alcanza vía `lead.contact` → `lead.contact.company`.
- Estados: `NOT_EXECUTED | IN_PROGRESS | COMPLETED | LOST | POSTPONED | PERMITS`.
- Rutas REST relevantes: `/projects/all`, `/projects/financials`, `/projects/:id/details`, `/projects/:id/payments`, `/projects/:id/estimate`, `/projects/:id/revert-to-lead`, `/projects/quickbooks-import/jobs`, `/projects/quickbooks-import/import`.
- **Hallazgo crítico:** toda la lógica de job costing, P&L, AP, cash-out, vendor transactions y `report bundle` existe como servicios en `maros-nest/src/modules/quickbooks/services/**` pero **solo está expuesta por MCP, no por REST**. El navegador no puede llegar a ella hoy.
- `QuickbooksReportsBundleService.getProjectReportBundle()` ya acepta `accountingMethod: 'Cash' | 'Accrual'`. **El toggle que pide David ya existe a nivel de servicio; falta la ruta HTTP y la pantalla.**

### Observaciones de la UI en producción (2026-09-27)
- Tema oscuro, acento teal, sidebar con grupos: Analytics (Dashboard), Meetings (Calendar, Start Meet), Business (Leads, Lost Leads, Projects, Import from QuickBooks, Completed Projects, Lost Projects, Notes, Tasks, …).
- La home del CRM es literalmente una lista titulada **"Available Categories"** con un botón por sección. Es un índice, no un panel: la primera pantalla no responde ninguna pregunta de negocio.
- `/projects` exige elegir antes un tipo (Construction / Roofing / Plumbing) y hasta entonces muestra "No projects found" con contador "0 of 0", pese a que el API tiene 109 proyectos. El vacío se lee como error.
- "Import from QuickBooks" es una **pestaña dentro de Projects**, no una ruta propia (`/quickbooks-import` da 404), aunque el sidebar la presenta como sección de primer nivel. Incoherencia de arquitectura de información.
- La tabla muestra un banner de carga en español ("Cargando montos de QuickBooks…") dentro de una UI en inglés. El idioma está mezclado.

---

## 1. Entregables

1. **Guía de estilo MARO** (aprobación previa) + migración de la UI.
2. **Invitaciones de usuario externo** con correo y allowlist en BD.
3. **"Llévame al reporte"** por proyecto, crudo, con toggle Cash/Accrual.
4. **Importar desde QuickBooks**, rehecho para que sea fácil.
5. **Plan de migración a Flutter** (documento, no código, en esta fase).

> Las secciones 2 a 6 se completan conforme aterrizan los informes de los agentes de QuickBooks, diseño frontend y superficie de API.

---

## 2. Acceso de usuarios externos (decisión: Google restringido a invitados)

### 2.1 El cambio de fondo
Mover la decisión "¿este correo puede entrar?" de una constante en el fuente a una consulta a la base de datos. Nada más. El resto del flujo de Google se queda igual.

### 2.2 Modelo de datos — `maros-nest/db/add-user-invitations.sql` (idempotente)

Dos cambios:

**a) Columnas nuevas en `users`**
| Columna | Tipo | Para qué |
|---|---|---|
| `user_type` | `text NOT NULL DEFAULT 'internal'` (`'internal' \| 'external'`) | Distinguir al externo del equipo |
| `status` | `text NOT NULL DEFAULT 'active'` (`'invited' \| 'active' \| 'disabled'`) | Hoy no existe estado "invitado pero nunca entró" |
| `scoped_company_id` | `int NULL REFERENCES companies(id)` | A qué empresa se limita |
| `scoped_contact_id` | `int NULL REFERENCES contacts(id)` | O a qué contacto |
| `invited_by_id` | `int NULL REFERENCES users(id)` | Auditoría |

**b) Tabla `user_invitations`** — misma forma que `note_page_links`, que ya está probada:
`id, user_id, email, token_hash, token_hint, expires_at, accepted_at, revoked_at, invited_by_id, created_at`.
Solo se guarda el SHA-256 del token; el crudo viaja una única vez, en el correo.

### 2.3 Backend
- `POST /users/invite` — `@RequirePermissions('users:write')`. Body: `{ email, name?, roleId, userType, scopedCompanyId?, scopedContactId?, expiresInDays? }`. Crea el `User` con `status='invited'`, genera token, persiste el hash, envía el correo. **Si el envío falla, revierte y devuelve error** (a diferencia del resto de call-sites de `MailService`).
- `POST /users/:id/invite/resend` y `DELETE /users/:id/invite` (revocar).
- `GET /auth/allowlist/check?email=` — interno, para que el callback de Next pregunte a la BD.

### 2.4 El cambio en el callback (el corazón)
En `maros-next/src/app/api/auth/google/callback/route.ts:88-98`, sustituir:
```ts
// antes
hd === WORKSPACE_DOMAIN || EXTERNAL_EMAIL_ALLOWLIST.has(email)
// después
hd === WORKSPACE_DOMAIN || await isInvitedActiveUser(email)
```
`isInvitedActiveUser` consulta el backend. Si el correo corresponde a un usuario con `status IN ('invited','active')` y `is_active = true`, entra; y si estaba `invited`, pasa a `active` y se marca `accepted_at` en la invitación. La constante hardcodeada se elimina (migrando antes esas dos direcciones a filas de la BD).

**Invariante de seguridad:** el correo de invitación **no autentica**. Solo avisa. La autenticación sigue siendo Google verificando que esa persona es dueña de ese buzón. Por eso el token de invitación es opcional para entrar — su único valor es trazar quién invitó, cuándo, y caducar el ofrecimiento.

### 2.5 Scoping — "que solo sea por parte del usuario acceder"
Hoy no hay filtrado por fila en ningún módulo. Se añade en el punto de menor superficie: `UsersService.resolveForRequest` adjunta `scopedCompanyId`/`scopedContactId` a `AuthenticatedUser`, y un `ScopeGuard`/interceptor filtra las consultas de `projects`, `leads`, `companies` y `contacts` cuando `userType === 'external'`.
**Regla de códigos de error:** fuera de alcance → **404**, nunca 403 (misma política que ya rige en notas; un 403 confirmaría que el recurso existe).

### 2.6 Rol nuevo `client`
Los roles sembrados (`admin`, `member`) son ambos internos y ven todo. Se siembra un rol `client` con permisos mínimos (`projects:read`, `dashboard:read`), que solo sirve acompañado del scoping por fila.

### 2.7 Frontend
- `maros-next/src/features/users/**`: botón "Invite user" en `UsersTable.tsx` (hoy **no existe ningún botón de alta**), modal con correo + rol + tipo + alcance, columna de estado (`invited`/`active`/`disabled`), acciones reenviar/revocar.
- Corregir de paso el desajuste de `AUTH_DEFAULT_ROLE` (`'Solo task'` no existe entre los roles sembrados).

---

## 3. "Llévame al reporte" (decisión: crudo, dentro de MAROS)

### 3.0 Lo que ya existe (más de lo esperado)
- `QuickbooksReportsFinancialService` ya llama a la Reports API de QBO para `ProfitAndLoss`, `ProfitAndLossDetail`, `CashFlow`, `BalanceSheet`, `VendorExpenses`, `VendorBalance`, `VendorBalanceDetail`, `AgedPayables`, `AgedPayableDetail`, `GeneralLedgerDetail`.
- **`accounting_method` ya es un parámetro de primera clase** (`ReportParams.accountingMethod: 'Cash' | 'Accrual'`, `quickbooks-reports.types.ts:93`), y se pasa verbatim a QBO en cada método (`quickbooks-reports-financial.service.ts:27-112`).
- Los reportes ya se pueden acotar por proyecto vía `customerId` (el Customer/Job de QBO).
- **Todo esto solo es alcanzable por MCP.** Ninguna ruta REST lo expone. El único reporte que el navegador alcanza hoy es `GET /analytics/quickbooks-revenue-report`, que **fija `accountingMethod: 'Accrual'` a fuego**, sin scoping por proyecto y sin `includeRaw`.

### 3.1 Lo que falta
El servicio ya existe y ya acepta Cash/Accrual. Falta exponerlo por HTTP y pintarlo.

- **Ruta nueva**: `GET /projects/:id/qbo-report` → envuelve `QuickbooksReportsBundleService.getProjectReportBundle()`.
  Query: `accountingMethod=Cash|Accrual`, `startDate`, `endDate`, `report=<nombre>`.
  `@RequirePermissions('finance:read')`.
- **Contrato "sin saneamiento"**: la ruta devuelve la respuesta de QBO **tal cual**, con sus `Columns`/`Rows` originales. Nada de mapear a un DTO propio, nada de recalcular totales. El frontend renderiza el árbol de filas genéricamente. Esto es a la vez lo que pidió David y lo que menos código nuevo exige.

### 3.2 Dónde se engancha
- **Detalle de proyecto**: botón en la fila de acciones de la cabecera, junto a "Revert to Lead" / "Delete" (`ProjectDetailsPage.tsx:580-606`).
- **Listado**: ítem en el menú contextual de fila (`useProjectsTableLogic.ts`, `buildExtraMenuItems`, ~líneas 121-129), junto a "Notes".
- **Pantalla**: `/project/[id]/report` con toggle Cash/Accrual, selector de rango y selector de reporte; tabla genérica que dibuja `Columns`/`Rows` de QBO sin interpretarlas.

### 3.3 Caso borde que hay que resolver antes
Un proyecto sin `qboCustomerId` no tiene reporte posible. El botón debe estar deshabilitado con explicación ("Este proyecto no está enlazado a un cliente de QuickBooks") y ofrecer el enlace al flujo de vinculación, no fallar con un error genérico.

---

## 4. Importar desde QuickBooks — "todo debe ser fácil"

### 4.0 Aclaración de terminología (importante antes de construir)
En el repositorio conviven **dos cosas distintas** que la gente llama "importar de QuickBooks":

| | **A. Import from QuickBooks** (la del menú) | **B. Invoice Scans** |
|---|---|---|
| Dirección | QBO → CRM | Papel/PDF → **hacia** QuickBooks |
| Qué hace | Vincula un *job* de QBO con un proyecto del CRM | OCR de facturas + sugerencias, para que un humano las teclee en QBO |
| Escribe en QBO | No | **No.** `suggestionOnly: true` |
| Ruta | `/projects/import-from-quickbooks` | `/finance/invoices/*` |

Este plan asume que "la feature de importar de QuickBooks" es **A**. Si David se refería a B, cambia el alcance por completo.

### 4.1 Cómo funciona A hoy
- `GET /projects/quickbooks-import/jobs` trae todos los `Customer` activos con `Job = true`, deduce un número de proyecto del `DisplayName` con regex, y cruza contra `leads`/`projects` para marcar los ya importados.
- `POST /projects/quickbooks-import/import` vincula o crea Lead+Project y fija `project.qboCustomerId` + `quickbooks = true`, dentro de una transacción.
- UI: tabla de jobs con buscador y toggle "mostrar importados", diálogo de revisión, un job a la vez.

### 4.2 Por qué no es fácil hoy
1. **Uno por uno.** No hay importación masiva ni selección múltiple. Vincular 100 jobs son 100 diálogos.
2. **No se puede deshacer.** `qboCustomerId` tiene índice único parcial y **la UI nunca permite limpiarlo ni cambiarlo**. Un error de vinculación requiere SQL a mano.
3. **Sin vista previa agregada.** El diálogo revisa un job; no hay "esto es lo que va a pasar con los 40 seleccionados".
4. **El emparejamiento por nombre es frágil.** `matchesProjectNumber` tenía un bug real (ya corregido sin commitear): el proyecto base `022-0325` podía resolver contra su propia orden de cambio `022-0325 CO01`, porque el número de la CO es un superstring del base.
5. **La corrección está a medias.** El trabajo sin commitear hace que `qboCustomerId` mande sobre el emparejamiento difuso en `quickbooks-financials-context.service.ts` y `quickbooks-job-costing.service.ts`, **pero `QuickbooksReportsContextService.buildJobIndex` sigue emparejando solo por nombre.** Queda una vía por la que el vínculo explícito se ignora.
6. **Sin realm explícito.** `resolveDefaultRealmId()` es literalmente `find({ take: 1 })` sobre `qbo_connections`. Con una sola empresa funciona; con dos, la primera fila que devuelva TypeORM se convierte en "la" empresa, en silencio.

### 4.3 Qué se hace
1. **Primero, cerrar el trabajo en curso.** Revisar y commitear los cambios pendientes de `maros-nest` (transacciones manuales + prioridad de `qboCustomerId`), y **extender la corrección a `buildJobIndex`** para que el vínculo explícito mande en las tres rutas, no en dos.
2. **Importación masiva**: selección múltiple en la tabla, auto-emparejamiento propuesto por el servidor, pantalla de revisión única que lista "crear N proyectos / vincular M / conflictos K", y un solo `POST /projects/quickbooks-import/import-batch` transaccional.
3. **Desvincular y revincular**: `DELETE /projects/:id/qbo-link` y la acción correspondiente en la UI. Sin esto, cualquier error es permanente.
4. **Estado de conexión visible**: hoy, si el token de QBO caduca, el backend lanza 503 `QBO_REAUTHORIZATION_REQUIRED` y el arreglo consiste en que un ingeniero visite `GET /quickbooks/connect` (una URL cruda del backend que además escribe HTML a mano en el controlador). Debe haber una tarjeta de conexión en ajustes con estado y botón de reconectar.
5. **Diferenciar vacío de error.** `attachEmpty()` ya distingue "no encontrado" de "$0" en el backend; la UI debe reflejarlo en lugar de pintar guiones ambiguos.

---

## 5. Rediseño MARO

### 5.1 Lo que hay que saber antes de tocar nada
- **54 pantallas** en `src/app`. El rediseño se hace por sistema, no pantalla por pantalla.
- **El tema oscuro está clavado a fuego**: `layout.tsx:36` fuerza `<html className="dark">`. No hay `ThemeProvider` de `next-themes` en ningún sitio; la única importación está en `components/ui/sonner.tsx`, donde `useTheme()` cae a `"system"` sin proveedor. **No existe modo claro.**
- **No hay tipografía propia.** `tailwind.config.ts:13` apunta a `var(--font-work-sans)`, una variable que **no se define en ninguna parte** de `src/`. La app cae silenciosamente a `system-ui`. No se usa `next/font`.
- **No hay escala tipográfica.** El componente `Typography` (`components/shared/Typography.tsx`, con variantes `h1..h4/body/small/muted/lead`) es el ancla de facto y debe convertirse en la escala real.
- `components.json`: estilo `new-york`, base `zinc`, variables CSS activas, iconos `lucide`.
- **`npm run ui:audit` está roto.** `scripts/ui-audit.mjs` y `ui-replace.mjs` se borraron en el commit `a57132a`, pero las cuatro entradas siguen en `package.json:14-17`.
- **`eslint-plugin-boundaries` está en `devDependencies` pero jamás se configura** en `eslint.config.mjs`. La arquitectura hexagonal por feature (`domain/application/infra/presentation`) existe por convención, sin ninguna red de seguridad automática.
- **11 tests renderizan componentes** (`sheet`, `useEntityTableLogic`, formularios de invoice-scans, `NotesHomeView`, `PaymentScheduleTable`, `TaskDatePicker`…). Son los que romperá el rediseño.

### 5.2 Deuda concreta de tokens (arreglar primero, es barato)
| Problema | Dónde | Acción |
|---|---|---|
| `--sidebar-*` definido **tres veces** | `globals.css` líneas ~17, ~454, ~478 | Colapsar a una |
| Puente de clases legacy (`.bg-theme-*`, `.text-theme-*`, `.bg-gray-900`, `.bg-[#1c2128]`…) | `globals.css` ~148-330 | **Borrar.** Cero usos fuera del propio CSS: la migración a shadcn ya ocurrió, esto es vestigio |
| `#1f1f1f !important` sobre diálogos/popovers de Radix | `globals.css` ~442-452 | Borrar |
| `bg-[#1f1f1f]` a fuego dentro de las primitivas | `ui/popover.tsx:24`, `ui/sheet.tsx:34`, `ui/dialog.tsx:41`, `ui/alert-dialog.tsx:39` | Volver a `bg-popover`/`bg-card` |
| Variables hex legacy (`--color-dark`, `--color-primary`…) | `globals.css` 7-24 | Borrar tras lo anterior |
| `<button>` crudo en **47 archivos** | `src/app/error.tsx`, `global-error.tsx`, muchos `features/**` | Normalizar a `Button` |
| `<select>`/`<input>` crudos | `NotesHomeView.tsx`, `TaskSavedViews.tsx`, `PendingAttachmentPicker.tsx`, `TaskDatePicker.tsx` | Normalizar |
| `SearchableSelect` reimplementa el combobox de shadcn | `components/shared/SearchableSelect.tsx` | Consolidar |

### 5.3 Dirección del sistema MARO
La identidad de marca es el wordmark **MAROS** en caja blanca, sans condensada, mayúsculas, sobre carbón. El CRM actual no se parece en nada: es un dashboard oscuro genérico con acento teal.

Tres decisiones de fondo que propongo (van en la guía de estilo para aprobar):

1. **Neutrales cálidos, no `zinc`.** `zinc` es gris azulado, frío, de producto SaaS. Los materiales de esta empresa son hormigón, acero y madera: grises cálidos. Cambiar la rampa neutral es el cambio que más hace por que la app "sepa" a constructora, y es solo cambiar tokens.
2. **Añadir modo claro.** No es cosmético: el personal de campo usa el móvil a pleno sol en Miami, y una UI solo-oscura es ilegible en esas condiciones. Además hoy el modo oscuro está clavado, así que el sistema de tokens **nunca se ha probado con dos temas** — es el momento de hacerlo bien, antes de tener 54 pantallas rediseñadas sobre un solo tema.
3. **Tipografía real.** Una condensada de peso alto para títulos (eco del wordmark) y una humanista legible para datos y tablas, servidas con `next/font`. Hoy no hay ninguna: es literalmente la fuente por defecto del sistema operativo.

### 5.4 Orden de trabajo
1. Guía de estilo visual (artefacto navegable) → **aprobación de David antes de seguir**.
2. Limpieza de tokens de §5.2 y tipografía con `next/font` (sin cambio visual de fondo todavía).
3. `ThemeProvider` + modo claro, verificando cada token en ambos temas.
4. Capa de primitivas: `Button`, `Typography`, `EntityTable`, `EntityFormModal`, `PageHeaderCard`, `PageToolbarCard`, badges.
5. Pantallas por orden de valor: **Home** (hoy es un índice de enlaces), Proyectos (listado + detalle), Import from QuickBooks, Leads, Tareas, Notas, el resto.
6. Restaurar `ui:audit` (o borrar las entradas muertas) y **configurar de una vez `eslint-plugin-boundaries`**, para que el rediseño no reintroduzca la deuda que acaba de pagarse.

---

## 6. Migración a una app móvil Flutter

### 6.1 Veredicto
La API es utilizable, pero **la autenticación es el bloqueante duro** y hay que resolverla antes de escribir una línea de Dart. Todo lo demás es trabajo incremental.

### 6.2 Los cinco bloqueantes reales

**B1 — El login no vive en el backend.** Todo el flujo de Google OAuth está en Next.js (`maros-next/src/app/api/auth/google/**`); Nest solo *verifica* la cookie que Next firmó, con un `AUTH_SECRET` compartido entre las dos apps. Una app Flutter no puede pasar por Next.
→ Mover la emisión de sesión a Nest: `POST /auth/google` (recibe el `id_token` del SDK nativo de Google, lo verifica contra el JWKS, devuelve tokens). Next pasa a consumir esa misma ruta, así no hay dos implementaciones.

**B2 — `SessionAuthGuard` solo lee la cookie.** No existe ninguna ruta de bearer para usuarios (`IntakeTokenGuard` y `McpAuthGuard` son secretos estáticos de máquina, no sirven).
→ Que el guard acepte `Authorization: Bearer <jwt>` además de la cookie. Es un cambio pequeño y el JWT ya es portable. `serverApiClient.ts` ya reenvía la cabecera `Authorization`, así que la infraestructura está medio puesta.

**B3 — No hay refresh token.** El JWT es plano, de 30 días, sin rotación. Renovarlo exige una vuelta completa de OAuth.
→ Access token corto (15 min) + refresh token rotativo persistido. Esto también arregla el problema actual de que un usuario desactivado conserve navegación durante 30 días.

**B4 — Adjuntar archivos a leads/proyectos/empresas/contactos solo existe como Server Action de Next.** `features/attachments/actions/s3Actions.ts` instancia su propio `S3Client` con credenciales AWS dentro de Next, con un esquema de claves distinto al de `ManagedFilesController`. Las Server Actions usan el protocolo RSC interno de Next: **un cliente Flutter no puede llamarlas.**
→ Portar ese flujo a rutas REST de Nest, reutilizando `ManagedFilesController`, que ya es móvil-compatible (intent → PUT presignado directo a S3 → complete).

**B5 — Lógica de negocio en el dominio del frontend.** `maros-next/src/features/*/domain/**` no son DTOs: hay máquinas de estado y validación reales (p. ej. `leadStatusPolicy.ts` valida transiciones de estado de lead, y **el backend no replica esa validación** en `PUT /leads/:leadId`). Reescribir eso en Dart duplicaría la regla en un tercer sitio.
→ Auditar feature por feature y mover las políticas al backend. Es prerrequisito, no trabajo paralelo.

### 6.3 Problemas de segundo orden
- **Endpoints sin paginar**: `/projects/all`, `/leads`, `/companies/all`, `/contacts/all`, `/crm/customers|clients`. `/leads` además hace fan-out a QuickBooks **por cada lead**. El módulo de tareas ya tiene paginación por cursor (`{items, totalCount, nextCursor}`) — ese es el patrón a replicar.
- **OpenAPI incompleto**: Swagger está montado en `/api/docs`, pero `nest-cli.json` **no tiene el plugin `@nestjs/swagger`**, así que los tipos no se infieren. Solo 64 de 96 DTOs tienen `@ApiProperty`, y módulos enteros (analytics, google-calendar, managed-files, task-workspaces) no tienen ninguna anotación. Activar el plugin es una línea y desbloquea la generación automática del cliente Dart.
- **Tiempo real**: hay un único SSE (`GET /tasks/events/stream`) que el navegador consume con `EventSource` nativo. Flutter no lo tiene: hace falta un paquete y reconexión manual.
- **Sin push**: las notificaciones son por sondeo (`GET /notifications/unread-count`). Una app móvil sin FCM/APNs no notifica en segundo plano.
- **Servicios externos llamados desde Next**: los webhooks de n8n de los reportes de restauración y las llamadas a OpenAI para traducción viven en Server Actions, fuera de Nest. Mismo problema que B4.
- **Sin despliegue como código para el backend**: no hay Dockerfile ni IaC; el indicio (`maros-nest-build-dist.tgz`) apunta a un despliegue manual empaquetado.

### 6.4 Fases propuestas
| Fase | Contenido | Resultado |
|---|---|---|
| 0 | B1+B2+B3: auth en Nest, bearer, refresh | Un cliente no-navegador puede autenticarse |
| 1 | B4+B5: subir archivos y políticas de dominio al backend | El backend es la única fuente de verdad |
| 2 | Paginación + plugin de Swagger + `@ApiProperty` faltantes | Cliente Dart generable automáticamente |
| 3 | App Flutter, alcance de campo: mis tareas, detalle de proyecto, adjuntar fotos, escanear facturas | Valor real en obra |
| 4 | FCM/APNs + SSE con reconexión | Paridad de tiempo real |

**Recomendación de alcance:** la app móvil **no debe ser el CRM entero**. El valor está en la obra: tareas propias, ficha del proyecto, subir fotos y escanear facturas desde el móvil. Portar analytics, notas con TipTap y la gestión de roles a Flutter es coste sin retorno.

---

## 7. Hallazgos colaterales (no estaban en el encargo; se reportan, no se arreglan sin permiso)

1. **Allowlist externa hardcodeada en el fuente** — dos correos de Gmail viven en el repositorio. Lo resuelve la sección 2.
2. **`AUTH_DEFAULT_ROLE = 'Solo task'`** no coincide con ningún rol sembrado en `db/create-users-tables.sql`. El commit `9b316d4 fix(auth): default new users to Solo task` indica que es deliberado y que ese rol existe en la BD de producción, pero **no está versionado**: una BD nueva deja a los usuarios sin rol y sin permisos, solo con un warning en log (`users.service.ts:214-218`). Falta el `INSERT` idempotente del rol.
3. **El middleware de Next solo valida la firma del JWT**, nunca pregunta al backend. Un usuario desactivado conserva navegación en el frontend durante hasta 30 días (el backend sí lo bloquea en cada request, así que no hay fuga de datos, pero la UX es confusa).
4. **La home del CRM es un índice de enlaces**, no un panel.
5. **`/projects` aparece vacío** hasta elegir tipo de obra; el vacío se lee como fallo.
6. **Idioma mezclado** (UI en inglés, mensajes de carga en español).
7. **"Import from QuickBooks" es pestaña pero se anuncia como sección**; `/quickbooks-import` da 404.
8. **Regla de visibilidad de notas escrita tres veces** (util, query builder, SQL crudo) — deuda ya documentada en `notes-sharing-plan.md`.
9. **`QB_ENCRYPTION_KEY` opcional con degradación silenciosa.** Si la variable no está puesta, `TokenCryptoService.encrypt/decrypt` hacen *passthrough en texto plano* sin fallar al arrancar: los tokens de QuickBooks quedan sin cifrar en la base de datos y nada lo advierte. Debería ser un fallo de arranque.
10. **Estado CSRF de OAuth en memoria** (`quickbooks.controller.ts:38`). El propio código lo comenta: se rompe con más de una instancia o tras un reinicio.
11. **Supuesto de un solo *realm* de QuickBooks incrustado en dos sitios.** `resolveDefaultRealmId()` y `resolveRealmId()` son ambos `find({ take: 1 })`. Correcto hoy, silenciosamente incorrecto el día que se conecte una segunda empresa.
12. **Credenciales de AWS duplicadas en dos aplicaciones.** `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` están tanto en `maros-nest` como en `maros-next`, que instancia su propio `S3Client` con un esquema de claves distinto. Dos rutas de subida paralelas e incoherentes.
13. **Sin despliegue como código para el backend**: no hay Dockerfile ni IaC en el repositorio.
14. **13 variables de ClickUp** en `.env.example` sin ningún módulo de ClickUp en `src/modules` — configuración muerta.
