# Auditoría de rendimiento — 28 de septiembre de 2026

Medición de sólo lectura. No se modificó ningún archivo de código de la aplicación.

## Cómo se midió

- **Backend**: peticiones GET autenticadas como admin contra `http://127.0.0.1:8080/api`, cronometradas
  de extremo a extremo y midiendo el cuerpo de la respuesta en bytes. «Frío» = después de
  `POST /api/analytics/refresh` (vacía el caché de lectura de QuickBooks, el caché de agregación y el
  caché HTTP de cache-manager). «Caliente» = repetición inmediata.
- **Consultas SQL por petición**: se usó `pg_stat_statements` (la extensión está instalada en la base),
  tomando una instantánea antes y otra después y restando. Esto da el número exacto de SELECT que
  provoca cada petición.
- **Frontend SSR**: cargas GET autenticadas de las páginas de Next en `http://127.0.0.1:3000`,
  repetidas hasta que la ruta ya estaba compilada.
- **Frontend cliente**: panel de red del navegador sobre una carga real de la aplicación.
- **Bundles**: tamaños de los chunks de `.next/static/` del build de producción existente
  (`BUILD_ID` con fecha 2026-09-27 20:39). No se ejecutó `next build` para no tocar el servidor en marcha.

### Advertencia sobre el ruido de la medición

Durante toda la auditoría había seis agentes editando el código. Eso provoca recompilaciones de Next
(HMR) y reinicios de `nest --watch` constantes. Los tiempos de *primera* carga de una ruta y algunos
picos aislados (se observó una carga de `/company` de 99 s y un reinicio del backend a media medición)
vienen de ahí, no de la aplicación. Todos los números que aparecen abajo son de estado ya compilado y,
donde importaba, repetidos. Donde no pude aislar la señal del ruido, lo digo.

---

## Dato que explica casi todo: la base de datos está a 130 ms

```
DB_HOST = aws-0-us-west-1.pooler.supabase.com (pgbouncer, puerto 6543)
conexión inicial:                          828 ms
RTT medio de un `SELECT 1` (20 intentos):  130,4 ms
```

El tiempo de ejecución en el servidor de estas consultas es de 0–3 ms. Es decir: **el coste de una
consulta a la base de datos es prácticamente todo latencia de red**. Por lo tanto

> tiempo de respuesta ≈ (nº de idas y vueltas a la BD **en serie**) × 130 ms + tiempo de la API de QuickBooks

Esta es la métrica que hay que vigilar, y es la causa directa de los tres problemas más caros del
informe. Verificación directa:

| Endpoint | Consultas SQL medidas | Tiempo medido | 130 ms × consultas |
|---|---|---|---|
| `/notifications/unread-count` (12 bytes de respuesta) | 2 (usuario + conteo) | 252–286 ms | 260 ms |
| `/projects/all` (101 KB de respuesta) | 2 (usuario + proyectos) | 263 ms (conexión caliente) | 260 ms |

Una respuesta de **12 bytes** cuesta lo mismo que una de **101 KB**. El tamaño del payload no es el
problema; el número de idas y vueltas sí.

---

## Tabla de endpoints

Tiempo en milisegundos, tamaño en bytes del cuerpo de la respuesta.

| Endpoint | Frío | Caliente | Tamaño | Consultas SQL/petición |
|---|---|---|---|---|
| `GET /projects/all` | 517–791 | 263–398 | 101 932 | 2 |
| `GET /projects/financials` | **8 348** (todos los cachés vacíos) | 2 405 (subcachés QBO tibios) / 653–667 (dentro de la ventana de 5 s del readCache) | 80 132–85 666 | 2 + hasta **57 lecturas de `qbo_connections`** |
| `GET /leads/type?type=CONSTRUCTION` | 1 119 | 1 094–1 578 | 32 288 | ~10 (incluye ruido) |
| `GET /contacts/all` | 616 | 517–607 | 65 914 | 4 |
| `GET /companies/all` | 268 | 258–271 | 44 270 | 8 (incluye ruido; el trabajo útil son 2) |
| `GET /tasks` | 755 | 702–916 | 50 122 | ~9 |
| `GET /notifications` | 423 | 386–475 | 9 707 | 2 |
| `GET /notifications/unread-count` | 318 | 252–286 | **12** | 2 |
| `GET /analytics/overview` | 2 903 | 139–151 | 244 | — |
| `GET /analytics/top-clients` | 1 593 | 131–157 | 1 038 | — |
| `GET /analytics/expenses-summary` | 266 | 130–131 | 97 | — |
| `GET /analytics/project-health` | 1 661 | 129–131 | 1 004 | — |
| `GET /invoice-scans` | 474 | 256–278 | 12 568 | 5 |
| `GET /quickbooks/projects/070P-0826/attachments` | **2 476–3 375** | 268–269 (sólo dentro de los 5 s del readCache) | **232** | 9 consultas paralelas a QuickBooks |
| `GET /projects/quickbooks-import/jobs` | 1 425–1 561 | 518–525 (sólo dentro de los 10 s del `queryAllCache`) | 59 098 | 1 consulta paginada de `Customer` a QBO |

Observación sobre `/projects/quickbooks-import/jobs`: en una de las pasadas midió **14 190 ms**. Pasó
justo cuando el caché de `queryAll` (10 s) había expirado y hubo que repaginar toda la lista de
`Customer` de QuickBooks. Es el mismo trabajo que normalmente cuesta 1,4 s; la variabilidad viene de
que QuickBooks respondió lento esa vez. Lo relevante es que ese trabajo se repite **cada 10 segundos**.

Los cuatro endpoints de `/analytics/*` están efectivamente resueltos: 129–157 ms en caliente gracias a
`ANALYTICS_CACHE_TTL_MS` (`src/modules/analytics/analytics.controller.ts:38`, 5 minutos). No están entre
los problemas.

---

## Páginas de Next (SSR, ya compiladas)

| Ruta | Render SSR (mejor de 3–5) | HTML | HTML con gzip |
|---|---|---|---|
| `/projects/construction` | 993–1 324 ms | 703 KB | **46 KB** |
| `/company` | 818–971 ms | 454 KB | **44 KB** |
| `/contacts` | 787–1 064 ms | 400 KB | **38 KB** |
| `/leads/construction` | 909–929 ms | 353 KB | — |
| `/tasks` | 446–455 ms | 126 KB | — |

Primera carga de cada ruta (compilación de desarrollo, **no** cuenta): 9 261 / 14 268 / 36 861 / 38 406 ms.

`/dashboard` devolvió HTTP 500 durante la auditoría (3 602 bytes de error). Muy probablemente porque
otro agente estaba editando ese archivo en ese momento; no lo pude medir.

---

## Los 5 problemas más caros

### 1. El token de QuickBooks se relee de la base de datos en cada llamada a la API de QBO

**Coste medido: hasta 7,4 s en una sola petición de `/projects/financials`.**

`src/modules/quickbooks/services/core/quickbooks-api.service.ts:436-437` construye un cliente axios
nuevo por cada llamada a QuickBooks, y para eso llama a `getValidAccessToken()`.

`src/modules/quickbooks/services/core/quickbooks-auth.service.ts:169-170` hace
`this.connectionRepo.findOneBy({ realmId })` **sin ningún caché en memoria**: cada llamada a la API de
QuickBooks provoca una ida y vuelta completa a Supabase para leer la misma fila.

Medido con `pg_stat_statements` durante **una sola** petición en frío a `GET /projects/financials`:

```
57  SELECT ... FROM qbo_connections ...        (tiempo de ejecución en el servidor: 1 ms en total)
```

57 lecturas × 130 ms de latencia = **~7,4 s de ida y vuelta a la base de datos** en una petición que
midió 8 348 ms en total. La fila es siempre la misma y el token dura una hora.

En una petición ya tibia (subcachés de job-costing y cronogramas calientes) bajan a 12 lecturas y la
petición cuesta 2 405 ms.

- **Arreglo**: cachear en memoria el `access_token` descifrado por `realmId` hasta unos minutos antes
  de `expiresAt`, e invalidarlo en `persistTokens`. Toda la maquinaria de refresco ya existe
  (`refreshInFlight`, `doRefreshTokens`); sólo falta no volver a la BD cuando el token en mano sigue
  siendo válido.
- **Ganancia estimada**: `/projects/financials` en frío de ~8,3 s a ~1–2 s. Beneficia a *todos* los
  endpoints que tocan QuickBooks.
- **Riesgo**: bajo. Un token cacheado que se invalide en el lado de Intuit provoca un 401 que el
  `withRetry` existente ya maneja; conviene limpiar la entrada del caché en ese camino.

### 2. `GET /projects/financials` no tiene caché HTTP

**Coste medido: 2 405–8 348 ms en cada carga de la pantalla de Projects.**

`src/modules/projects/project-management/projects.controller.ts:126` expone `@Get('financials')` y
`ProjectsController` **no lleva `@UseInterceptors(CacheInterceptor)`** (el `AnalyticsController` sí, en
`analytics.controller.ts:41`). El servicio (`services/projects.service.ts:235`) sí se apoya en los
subcachés de QuickBooks, pero la respuesta completa se vuelve a construir en cada petición.

Medido: tres ciclos de `refresh` + petición dieron 2 277 / 2 380 / 1 909 ms; la repetición inmediata
(dentro de los 5 s del readCache) dio 667 / 658 / 653 ms; con todos los cachés vacíos, 8 348 ms.
Nunca baja de ~650 ms, mientras que los endpoints de analytics cacheados responden en 130 ms.

- **Arreglo**: aplicar `CacheInterceptor` + `@CacheTTL` al endpoint, con el mismo TTL que analytics, y
  añadirlo a la lista que `POST /analytics/refresh` vacía.
- **Ganancia estimada**: de 2,4–8,3 s a ~150 ms para todos menos el primer visitante de cada ventana
  de 5 minutos. Es exactamente la mejora que ya se logró con `project-health`.
- **Riesgo**: bajo. Cifras financieras con hasta 5 minutos de antigüedad, igual que el resto del
  tablero. Ojo: la respuesta depende del permiso `finance:read` y `CacheInterceptor` indexa por URL —
  hay que aplicar el mismo criterio que ya documenta el comentario de `analytics.controller.ts:42-45`.

### 3. Los cachés de lectura de QuickBooks duran 5 y 10 segundos

**Coste medido: 3 232 ms → 268 ms (‑92 %) en `/quickbooks/projects/.../attachments`; 1 425 ms → 518 ms en `/projects/quickbooks-import/jobs`.**

`src/modules/quickbooks/services/core/quickbooks-api.service.ts:39` fija `readCacheTtlMs = 5_000` y la
línea `:41` fija `queryAllCacheTtlMs = 10_000`. Medido, tres llamadas seguidas al mismo endpoint de
adjuntos:

```
3 232 ms   (primera)
  268 ms   (dentro de la ventana de 5 s)
  268 ms   (dentro de la ventana de 5 s)
```

Y cuatro llamadas seguidas a `import/jobs`: 1 425 / 520 / 525 / 518 ms. La ventana es tan corta que en
uso real casi nunca se acierta: cualquier usuario que tarde más de cinco segundos en pinchar dos veces
paga el precio completo otra vez. En una pasada se midió un pico de **14 190 ms** en `import/jobs` justo
tras expirar la ventana.

- **Arreglo**: subir el TTL de las lecturas de QuickBooks a minutos y purgar explícitamente en las
  escrituras (ya existe `clearReadCache()`, línea `:540`). El comentario del código
  (`:37-38`) dice que la ventana corta existe para que los cambios hechos *dentro de QuickBooks* se vean
  pronto; eso se puede conseguir igual con el botón de `POST /analytics/refresh` que ya existe.
- **Ganancia estimada**: de ~3,2 s a ~0,27 s en adjuntos y de ~1,4 s a ~0,5 s en jobs, para toda
  navegación posterior dentro de la ventana.
- **Riesgo**: medio. Un cambio hecho directamente en QuickBooks tarda más en aparecer. Se mitiga con
  el refresco manual.

### 4. Cada petición autenticada paga una consulta extra a la base de datos (≈130 ms)

**Coste medido: 130 ms fijos en todas las peticiones; ~4,6 peticiones autenticadas por render de página.**

`src/common/guards/session-auth.guard.ts:136` llama a `usersService.resolveForRequest()`, que en
`src/modules/users/user-management/users.service.ts:54-56` hace `findByEmail` contra la base de datos
en **cada** petición. El comentario del guardia (`session-auth.guard.ts:21-25`) lo justifica: los
permisos se resuelven por petición para que una baja o un cambio de rol surta efecto de inmediato. El
razonamiento es correcto; el problema es que esa decisión cuesta 130 ms porque la base está en otro
continente.

Verificación: 10 peticiones a `/notifications/unread-count` produjeron exactamente 10 consultas de
usuario y 10 de conteo, y cada petición midió 252–286 ms para devolver **12 bytes**.

Además, 5 renders SSR de `/company` produjeron 23 pares de consulta de usuario, es decir **~4,6
peticiones autenticadas por render de página** (las tres útiles son companies, contacts y services).

- **Arreglo**: cachear en memoria el `AuthenticatedUser` resuelto por email durante 30–60 s, e
  invalidarlo cuando se modifica un usuario o un rol.
- **Ganancia estimada**: ~130 ms menos en cada petición del sistema. Un render de `/company` ahorraría
  ~0,6 s de latencia agregada.
- **Riesgo**: medio. Una desactivación o un cambio de rol tardaría hasta un minuto en aplicarse, que es
  justo lo que el diseño actual quiso evitar. Es una decisión de producto, no sólo técnica.

### 5. El endpoint de adjuntos de QuickBooks lanza nueve consultas a QBO para devolver 232 bytes

**Coste medido: 2 476–3 375 ms por respuesta de 232 bytes, sin caché HTTP.**

`src/modules/quickbooks/services/attachments/quickbooks-attachments.service.ts:148`
(`getProjectAttachments`) encadena tres fases en serie: resolver el realm, resolver el proyecto
(`findProjectRefs`, que a su vez consulta `Customer` en QBO), y después
`getProjectRelatedEntityRefs`, que en
`src/modules/quickbooks/services/attachments/quickbooks-attachments.project.ts:111` dispara un
`Promise.all` de **nueve** consultas a QuickBooks (Invoice, Estimate, Payment, Purchase, Bill,
BillPayment, VendorCredit, PurchaseOrder, JournalEntry), y luego aún busca los `Attachable`.

Para el proyecto `070P-0826` el resultado son **232 bytes**. El trabajo se repite entero en cada
apertura de la ficha de proyecto porque el controlador no tiene caché HTTP.

- **Arreglo**: (a) caché HTTP por `projectNumber` con el mismo TTL de analytics; y (b) evaluar mover
  esta recolección a segundo plano, exactamente como ya se hizo con los PDF de los calendarios de pago
  y su bandera `paymentSchedulePending` (`quickbooks-payment-schedule.service.ts`): la ficha se
  pinta al instante y los adjuntos aparecen cuando llegan.
- **Ganancia estimada**: de ~3,2 s a ~0,15 s en aperturas repetidas; con el patrón de segundo plano,
  la ficha deja de esperar los 3,2 s en la primera apertura también.
- **Riesgo**: bajo para el caché; medio para el fondo, porque hay que añadir estado «pendiente» a la
  interfaz (pero el precedente ya existe y funciona).

---

## Frontend: peticiones por pantalla

### Confirmado: `/notifications/unread-count` se pide dos veces por carga de página

Medido en el navegador, sobre una carga completa de `/company`, filtrando el panel de red por
`localhost:8080`:

```
1. GET /api/notifications/unread-count   200
2. GET /api/notifications/unread-count   200
```

Dos peticiones, 252–286 ms cada una, para devolver 12 bytes.

Hay **dos montajes** del mismo componente:
- `maros-next/src/app/AppShell.tsx:47` → `<NotificationBell />`
- `maros-next/src/components/sidebar/AppSidebar.tsx:254` → `<NotificationBell />`

y el hook `maros-next/src/features/notifications/presentation/hooks/useUnreadCount.ts:9-14` no fija
`staleTime` y además **reactiva** `refetchOnWindowFocus: true`, en contra del valor por defecto de la
aplicación (`maros-next/src/shared/lib/queryClient.ts:20` lo pone en `false`), y añade
`refetchInterval: 60_000`.

No pude determinar con certeza cuál de los dos factores produce la segunda petición (la `queryKey` es
la misma en ambos montajes, `notificationsKeys.unreadCount()`, así que React Query debería deduplicar;
lo que mido es el resultado, no la causa interna). Lo que sí está medido es que **son dos**.

- **Arreglo**: renderizar una sola campana (elegir entre la cabecera y la barra lateral, o elevar el
  estado), y darle a `useUnreadCount` un `staleTime` explícito (p. ej. `STALE_TIMES.volatile`, 30 s,
  que ya existe en `queryClient.ts:12`) en vez de heredar el de 5 minutos y contradecirlo con
  `refetchOnWindowFocus`.
- **Ganancia**: una petición de 260 ms menos por navegación, y la mitad del tráfico de sondeo.
- **Riesgo**: muy bajo.

### NO confirmado: `/companies/all` pedido varias veces

Esto **no se reprodujo**. Dos medidas independientes:

1. **Navegador**, carga completa de `/company`: **cero** peticiones a `/companies/all` desde el cliente.
   Los datos de la lista los trae el render del servidor
   (`maros-next/src/features/company/presentation/data/loadCompaniesData.ts:36-40`), y el cliente los
   recibe como `initialData`. La única petición que sale del navegador es la de `unread-count`.
2. **Contador de SQL**, 5 renders SSR de `/company` (con el resto del sistema en reposo verificado:
   una ventana ociosa de 60 s produjo 0 consultas de `Company`):

```
5  SELECT ... FROM companies ...
5  SELECT ... FROM contacts ...
5  SELECT ... FROM company_services ...
```

Exactamente **una de cada por render**. No hay duplicado en el servidor.

Sí existe en el código un camino que puede pedir companies sin `initialData` desde el cliente:
`maros-next/src/features/company/presentation/hooks/data/useContactsData.ts:19` y
`maros-next/src/features/project/presentation/pages/ProjectDetailsPage.tsx:399` llaman a
`useInstantCompanies()` sin argumentos, mientras que
`maros-next/src/features/company/presentation/hooks/data/useCompanyData.ts:24` la llama con
`initialData?.companies`. Ambos comparten la misma `queryKey` (`companyKeys.lists()`), así que el que
monte primero decide si hay o no datos iniciales. Es un riesgo real de doble petición en las pantallas
de contactos y de detalle de proyecto, pero **no lo pude medir**: en las mediciones que hice esas rutas
resolvieron companies en el servidor. Si el dueño lo vio, lo más probable es que fuera en una
navegación cliente-a-cliente entre `/company` y `/contacts`; no conseguí reproducirlo de forma limpia
porque otros agentes estaban usando el mismo navegador durante la auditoría.

---

## Peso del cliente

Medido sobre el build de producción existente en `maros-next/.next/` (`BUILD_ID` de 2026-09-27 20:39).
No se ejecutó `next build` para no interferir con el servidor de desarrollo en marcha, así que estos
números pueden no reflejar los cambios de hoy.

**Bundle compartido inicial** (`rootMainFiles`): **382 KB sin comprimir → 113 KB con gzip.**

```
  3 KB  webpack-3d74efd37237ea91.js
194 KB  4bd1b696-a81117ca0521e8a3.js
184 KB  3794-488aec4e5dbb8192.js
  0 KB  main-app-04d2cfdbfd79477b.js
```

**Chunks más grandes del proyecto** (crudo / gzip):

| Chunk | Crudo | Gzip | Contenido identificado | ¿En el bundle inicial? |
|---|---|---|---|---|
| `6919-…` | 520 KB | 144 KB | (no identificado; contiene `lucide`) | No |
| `2682-…` | 493 KB | 150 KB | **recharts** (85 menciones) | No |
| `3709.…` | 481 KB | 124 KB | **mammoth** | No — carga diferida |
| `3525-…` | 305 KB | 95 KB | prosemirror / tiptap | No |

Total de `.next/static/chunks`: **4,3 MB** sin comprimir.

Los chunks de entrada por ruta son pequeños: el mayor es `/tasks` con 34 KB, luego
`/reports/restoration-visit` con 31 KB y el layout con 29 KB.

Dos cosas que **no** son problema, y conviene dejarlo escrito para no perseguirlas:

- **recharts (493 KB)** se importa de forma estática en cuatro widgets
  (`maros-next/src/features/analytics/presentation/widgets/*.tsx`), pero el único consumidor es
  `maros-next/src/app/reports/quickbooks/revenue/RevenueReportContent.tsx:8`. No está en el bundle
  compartido inicial. Sólo lo paga quien abre el informe de ingresos.
- **mammoth (481 KB)** ya se carga con `await import("mammoth")` en
  `maros-next/src/features/leads/presentation/pages/sections/FilePreviewModal.tsx:108`. Sólo se
  descarga al previsualizar un `.docx`.

Lo que sí vale la pena mirar:

- `maros-next/next.config.ts:6` define una función `webpack`. En Next 16 eso **desactiva Turbopack**, y
  lo único que hace esa función es fijar `config.output.uniqueName`. Es la causa más probable de que las
  compilaciones de desarrollo que medí tarden 9–38 s por ruta. No lo pude verificar con un experimento
  A/B porque eso exigía modificar el archivo.
- No hay `optimizePackageImports` configurado. `lucide-react` ocupa 35 MB en `node_modules` y aparece en
  el chunk de 520 KB. No pude medir cuánto de ese chunk es lucide.

---

## Lo que parece lento pero NO lo es

Para no perseguir fantasmas:

1. **La primera carga de cada ruta en desarrollo (9 261 / 14 268 / 36 861 / 38 406 ms).** Es la
   compilación de webpack. La misma ruta, ya compilada, rinde 446–1 324 ms. **No es un problema de
   producción.** El pico de 99 s que vi en `/company` fue una recompilación por HMR provocada por otro
   agente guardando un archivo.

2. **El HTML de 703 KB de `/projects/construction`.** Con gzip son **46 KB**. `/company` pasa de 454 KB
   a 44 KB, `/contacts` de 400 KB a 38 KB. Es marcado repetitivo que comprime a un 6–10 %. No es el
   cuello de botella.

3. **Los endpoints de `/analytics/*`.** Ya están resueltos: 129–157 ms en caliente. El trabajo de hoy
   sobre `project-health` funcionó — se mide 1 661 ms en frío y 129 ms en caliente. No hay nada más
   que rascar ahí.

4. **El tamaño de las respuestas de la API.** `/projects/all` devuelve 101 KB en 263 ms;
   `/notifications/unread-count` devuelve 12 bytes en 252 ms. La serialización y el ancho de banda no
   pesan; lo que pesa son las idas y vueltas.

5. **`/projects/quickbooks-import/jobs` con 14 190 ms.** Fue una sola observación. Las cuatro medidas
   posteriores dieron 1 425 / 520 / 525 / 518 ms. Es varianza de la API de QuickBooks, no un problema
   estructural del endpoint — el problema estructural es que ese trabajo se repite cada 10 s (ver
   problema 3).

6. **N+1 de consultas en la lista de proyectos.** Lo busqué y **no existe**:
   `ProjectQboEnrichmentService.enrichProjectsSummary`
   (`src/modules/quickbooks/services/crm-bridge/project-qbo-enrichment.service.ts:67-93`) agrupa los 109
   proyectos en cuatro llamadas por lotes, no una por proyecto. `findAll`
   (`services/projects.service.ts:212`) resuelve con **una sola** consulta SQL con relaciones, medido:
   2 consultas por petición, 263 ms. El N+1 que sí existe es el del token de QuickBooks (problema 1),
   que es por *llamada a la API*, no por proyecto.

---

## Lo que no pude medir

- **`/dashboard`**: devolvió HTTP 500 durante toda la ventana de auditoría, casi con seguridad por una
  edición concurrente. Sin número.
- **La causa interna exacta de la doble petición de `unread-count`**: medí que son dos; no pude aislar
  si viene del doble montaje o de la configuración del hook.
- **La duplicación de `/companies/all`**: no se reprodujo en ninguna de las dos formas de medirla.
- **El coste real de desactivar Turbopack**: exigía editar `next.config.ts`.
- **El reparto interno del chunk de 520 KB**: sé que contiene `lucide` pero no en qué proporción.
- **Tamaños de bundle actualizados**: el build disponible es de ayer por la tarde.

---

# Resultados tras los arreglos

Aplicados el 28 de septiembre de 2026, después de la auditoría de arriba. Mismo método: peticiones GET
autenticadas como admin contra `http://127.0.0.1:8080/api`, «frío» = después de `POST /api/analytics/refresh`,
«caliente» = repeticiones inmediatas. El conteo de consultas SQL sigue saliendo de `pg_stat_statements`.
Cada arreglo se midió por separado, en el orden en que aparece.

## Resumen

| Endpoint | Antes (frío) | Después (frío) | Antes (caliente) | Después (caliente) |
|---|---|---|---|---|
| `GET /projects/financials` | 1 825–2 561 (8 348 con todo vacío) | 1 395–2 132 | 530–657 | **3–4** |
| `GET /quickbooks/projects/…/attachments` | 2 287–3 262 | 1 825–2 357 | 267–303 (sólo dentro de 5 s) | **1–2** |
| `GET /projects/quickbooks-import/jobs` | 1 502–1 853 | 983–1 042 | 519–525 (sólo dentro de 10 s) | **384–398** |
| `GET /notifications/unread-count` | — | — | 265–272 | **129–131** |
| `GET /projects/all` | — | — | 263–398 | **138–142** |
| `GET /contacts/all` | — | — | 517–607 | **135–139** |
| `GET /companies/all` | — | — | 258–271 | **130–135** |

## 1. Token de QuickBooks cacheado en memoria

`quickbooks-auth.service.ts`: `getValidAccessToken` sirve el token descifrado desde un `Map` por `realmId`
mientras le quede más de `EXPIRY_BUFFER_SECONDS` de vida, con deduplicación de fallos de caché concurrentes
(`tokenLoadInFlight`) para que una ráfaga de llamadas paralelas provoque una sola lectura. `persistTokens`
rellena la entrada — cubre a la vez el reconectar por OAuth y el refresco —, y el camino de 401 de
`quickbooks-api.service.ts` llama a `invalidateAccessToken` antes de refrescar.

Medido con `pg_stat_statements`, lecturas de `qbo_connections` en **una sola** petición en frío a
`/projects/financials`, separando las dos formas de consulta:

```
ANTES:    15  findOneBy(realmId)  [token]  +  4  find({take:1})  [resolución de realm]   = 19
DESPUÉS:   0  findOneBy(realmId)  [token]  +  3  find({take:1})  [resolución de realm]   =  3
```

Las lecturas de token desaparecen por completo. Las 3 que quedan son la resolución del realm que hacen
`quickbooks-financials-context.service.ts` y compañía con `find({ take: 1 })`, que es otro asunto y no se tocó.

Primera petición tras reiniciar el backend, con absolutamente todo vacío: **8 067 ms → 6 237 ms**.
El resto de esa petición es la API de QuickBooks, no la base de datos.

## 2. `/projects/financials` con caché

No se usó `CacheInterceptor`. Motivo medido: `CacheModule` está registrado **por módulo**
(`analytics.module.ts`, `quickbooks.module.ts`), así que `POST /analytics/refresh` sólo vacía la instancia
de `AnalyticsModule`; un interceptor en `ProjectsController` habría creado un caché que el botón de refrescar
no puede limpiar. Se cacheó dentro del servicio (`projects.service.ts`, `findAllFinancials`), con TTL de
5 minutos igual que analytics, deduplicación de peticiones concurrentes en frío, y
`clearFinancialsCache()` llamado desde `POST /analytics/refresh`.

Sobre la fuga de permisos: la comprobación de `finance:read` está **antes** del caché y lo único que se
guarda es la vista de quien sí tiene el permiso. Un usuario sin `finance:read` sale por el `return []`
sin llegar a leer ni escribir el caché, así que no existe una clave que pueda entregarle la respuesta de
otro. Además la ruta ya está cerrada entera con `@RequirePermissions('finance:read')` y los guards de Nest
corren antes que los interceptores. Una respuesta degradada (QBO agotó los 25 s) no se cachea, para no
dejar la pantalla clavada en un error durante cinco minutos.

- Caliente: **530–657 ms → 3–4 ms**.
- Verificación real de la fuga, con el caché caliente: el usuario `agonzalez` con rol `Solo task`
  (`tasks:read`, `tasks:write`) recibe **HTTP 403, 163 bytes**, mientras el admin recibe 80 132 bytes.

## 3. Cachés de lectura de QBO subidas a minutos

`quickbooks-api.service.ts`: `readCacheTtlMs` 5 s → **5 min** y `queryAllCacheTtlMs` 10 s → **5 min**.
Se revisaron los caminos de purga: `mutateEntity` ya llamaba a `clearReadCache()`, pero **`createInvoice` no
lo hacía** — se añadió. También se añadió en los cuatro puntos donde cambia un vínculo proyecto↔job
(`quickbooks-project-import.service.ts`: `importJob`, `importBatch`, enlazar y `unlinkProject`), junto al
`invalidateJobIndex()` que ya existía.

La ventana corta era el problema real. Medido con 20 s entre llamadas, es decir fuera de las ventanas
viejas de 5 s y 10 s, que antes habrían costado el precio completo otra vez:

```
attachments   t=+0s 2 931 ms   t=+20s 265 ms   t=+40s 265 ms
import/jobs   t=+0s 1 159 ms   t=+20s 650 ms   t=+40s 645 ms
```

## 4. Adjuntos de QuickBooks cacheados

`quickbooks-attachments.service.ts`: `getProjectAttachments` guarda el resultado ya montado (las nueve
consultas paralelas más los `Attachable`) mediante `cacheDerivedRead`, un método nuevo y pequeño de
`quickbooks-api.service.ts` que reutiliza el `readCache` que ya existía. Al vivir en ese mismo mapa, lo
purgan automáticamente todos los caminos que ya purgaban: escrituras, cambios de vínculo y
`POST /analytics/refresh`. La clave incluye realm, número de proyecto, `qboCustomerId` y el rango de fechas.

Las respuestas con `includeTempDownloadUrl=true` **no** se cachean: QuickBooks rota esas URL y una cacheada
le daría a la interfaz un enlace muerto. Eso ya lo advertía el comentario del controlador.

- **3 100 ms → 137 ms** con 20 s entre llamadas; 1–2 ms en repeticiones inmediatas.

**No** se movió a segundo plano al estilo de `paymentSchedulePending`. Habría exigido tocar
`ProjectDetailsPage.tsx` y su carpeta `sections/`, que en este momento está reescribiendo otro agente para
pasarla a pestañas. Con las aperturas repetidas ya en 137 ms, el fondo sólo habría mejorado la primera
apertura, y no a costa de chocar con ese trabajo.

## 5. Usuario resuelto cacheado — y por qué la corrección sigue en pie

Éste era el delicado. El comentario de `session-auth.guard.ts` decía que los permisos se resuelven por
petición para que un cambio de rol o una baja surtan efecto al instante en vez de esperar los 30 días del
token. **Esa propiedad se conserva, y no a cambio del TTL.**

La decisión: TTL corto de **30 s** (`RESOLVED_USER_TTL_MS` en `users.service.ts`) **más invalidación
explícita** en todo lo que cambia quién es alguien o qué puede hacer:

| Camino | Qué cambia | Invalidación |
|---|---|---|
| `UsersService.update` | rol, `isActive` | `invalidateResolvedUser(email)` |
| `RolesService.update` | permisos de un rol (afecta a todos sus titulares) | `invalidateAllResolvedUsers()` |
| `UserInvitationsService.revoke` | desactiva la cuenta | `invalidateResolvedUser(email)` |

El TTL de 30 s es sólo la red de seguridad por si un camino nuevo olvida invalidar, no el mecanismo
previsto. Una cuenta desactivada nunca se cachea: lanza `UserInactiveException` antes de escribir la
entrada. El comentario del guardia se reescribió para decir exactamente esto, en vez de seguir afirmando
que se resuelve en cada petición.

Prueba real contra el servidor en marcha, cambiando el rol **por la API** (`PATCH /users/11`):

```
1) agonzalez con rol member, GET /companies/all      200  (842 ms)
   repetida, ya cacheada                             200  (131 ms)
2) el admin lo degrada a "Solo task"                 200
3) PETICIÓN INMEDIATAMENTE DESPUÉS                   403  (132 ms)   <- surte efecto ya
4) se restaura el rol member                         200
5) acceso restaurado                                 200
```

Ganancia: **~130 ms menos en toda petición autenticada**. `/notifications/unread-count` pasa de 265–272 ms a
129–131 ms; `/projects/all` de 263–398 a 138–142; `/contacts/all` de 517–607 a 135–139.

## 6. Frontend: el contador de no leídas se pedía dos veces

`useUnreadCount.ts` forzaba `refetchOnWindowFocus: true` contra el valor por defecto de la aplicación
(`queryClient.ts`, `false`) y no fijaba `staleTime`. Se le puso `staleTime: STALE_TIMES.volatile` (30 s) y se
quitó el `refetchOnWindowFocus`; `refetchInterval: 60_000` se mantiene y basta para refrescar la insignia.

Los **dos montajes se dejaron como estaban**: no son un duplicado sino dos puntos de ruptura distintos —
la cabecera móvil de `AppShell` es `md:hidden` y el de `AppSidebar` va en el pie de la barra lateral.
Quitar uno rompería uno de los dos tamaños de pantalla. Comparten `queryKey`, así que una sola petición
sirve a los dos.

Medido en el navegador, panel de red filtrado por `localhost:8080`, igual que la auditoría:

```
ANTES:    2 peticiones a /api/notifications/unread-count por carga
DESPUÉS:  1 petición   (verificado en dos cargas: /company y /contacts)
```

## Verificación

- `npx tsc --noEmit` limpio en `maros-nest` y en `maros-next`.
- `npx jest` en `maros-nest`: **420 pruebas en verde, 48 suites** (eran 401). Las 19 nuevas cubren el caché
  del token de QBO, el del usuario con su invalidación, y el de `/projects/financials` con su propiedad de
  no filtrar entre permisos.

## Lo que quedó sin hacer

- **Adjuntos en segundo plano** (punto 4): descartado a propósito, chocaba con la reescritura en curso de
  `ProjectDetailsPage.tsx`.
- **`/projects/quickbooks-import/jobs` sigue en ~390 ms** en caliente, no en 130. Es correcto: `listJobs()`
  relee leads y proyectos de la base en cada llamada (dos idas y vueltas) precisamente para que un vínculo
  recién creado se vea al momento. Cachear eso reintroduciría el problema que el punto 3 evita.
- **Las 3 lecturas de `qbo_connections` para resolver el realm** que siguen apareciendo por petición
  (`find({ take: 1 })` en los servicios de contexto de QBO). Son idas y vueltas que se podrían quitar con el
  mismo patrón del punto 1, pero estaba fuera del encargo.
- **`/tasks` (395–431 ms) y `/notifications` (260–265 ms)** siguen haciendo varias consultas en serie. No
  estaban en la lista.
- Nada del apartado de **peso del cliente**: Turbopack en `next.config.ts`, `optimizePackageImports`,
  el reparto del chunk de 520 KB. No se tocó `next.config.ts`.
