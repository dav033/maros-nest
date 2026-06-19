# Plan de Tests — Backend (maros-nest)

> Objetivo: **garantizar que un deploy no rompa**. Cada PR/push a la rama de
> deploy debe pasar una batería de comprobaciones que detecten, en orden de
> coste creciente: errores de compilación, fallos de arranque (DI/env), regresiones
> de lógica de negocio y roturas de los flujos críticos (auth, leads→contacto,
> proyecto→WON, mail, S3).

---

## 1. Estado actual

| Aspecto | Estado |
|---|---|
| Framework de test | Jest + ts-jest **ya configurado** en `package.json` (`jest` block) |
| Utilidades | `@nestjs/testing`, `supertest`, `@types/jest`, `@types/supertest` ya instalados |
| Tests existentes | **0** (scripts usan `--passWithNoTests`) |
| CI | **No existe** (`.github/workflows` ausente) |
| Deploy | `nest build` → `node dist/main`; conecta a Postgres (Supabase) vía `data-source.ts` |
| Config crítica | `ConfigModule.forRoot` carga `.env.local`/`.env`; `ValidationPipe` global con `whitelist + forbidNonWhitelisted + transform + enableImplicitConversion` |

---

## 2. Pirámide de tests (de más barato/rápido a más caro)

```
        ╱╲   Tier 4: E2E (supertest, DB real efímera)   — pocos, flujos críticos
       ╱──╲  Tier 3: Integración (servicio + repos + DB testcontainers)
      ╱────╲ Tier 2: Unit (lógica pura + servicios con repos mockeados)
     ╱──────╲Tier 1: Boot/Smoke (grafo DI compila, /health responde)
    ╱────────╲Tier 0: Estático (typecheck + lint + build)  ← bloquea el 70% de roturas de deploy
```

**Regla de oro de deploy-safety:** Tier 0 + Tier 1 son obligatorios y baratos; deben
correr SIEMPRE antes de desplegar. Tiers 2–4 suben la confianza y previenen
regresiones funcionales.

---

## 3. Herramientas a añadir

```bash
# Para Tier 3 (DB hermética, sin tocar Supabase de prod):
npm i -D @testcontainers/postgresql testcontainers

# (Opcional) reporte y separación de suites:
npm i -D jest-junit            # para artefactos de CI
```

> **No** se necesita nueva librería para Tier 0/1/2/4: Jest + Nest testing + supertest bastan.

### Separar configuración de Jest

Mover el bloque `jest` de `package.json` a archivos dedicados:

- `jest.config.unit.js` → `testRegex: '\\.spec\\.ts$'`, `rootDir: 'src'` (rápido, sin DB).
- `jest.config.e2e.js` → `testRegex: '\\.e2e-spec\\.ts$'`, `rootDir: 'test'`, `maxWorkers: 1`.

Scripts nuevos en `package.json`:
```jsonc
"test:unit": "jest -c jest.config.unit.js",
"test:e2e": "jest -c jest.config.e2e.js --runInBand",
"test:cov": "jest -c jest.config.unit.js --coverage",
"verify": "npm run lint && tsc --noEmit && npm run build && npm run test:unit"
```
`verify` es **el comando que debe correr el CI antes de desplegar**.

---

## 4. Tier 0 — Gates estáticos (implementar PRIMERO)

Estas tres comprobaciones, sin escribir un solo test, ya evitan la mayoría de
deploys rotos:

1. **Typecheck**: añadir script `"typecheck": "tsc --noEmit"` (hoy `nest build` ya
   tipa, pero un `tsc --noEmit` explícito es más rápido y claro en CI).
2. **Lint**: `npm run lint` (ya existe) — debe pasar sin errores.
3. **Build**: `npm run build` debe generar `dist/` sin fallar.

**Tarea:** que CI ejecute los 3 en cada push. Si alguno falla → no se despliega.

---

## 5. Tier 1 — Boot / Smoke tests

Detectan el fallo de deploy más insidioso: **el código compila pero la app no
arranca** (dependencia DI mal provista, módulo no importado, `process.env` leído
en mal momento — exactamente el bug que tuvimos con `AUTH_PASSWORD`).

### 1.1 Test de arranque del grafo DI (sin DB)
`test/boot/app-boots.e2e-spec.ts`
- Crear el `TestingModule` con `AppModule`, **sobreescribiendo `DataSource`** y los
  repos TypeORM con mocks (o un `DataSource` sqlite en memoria) para no depender de
  Supabase.
- Aserción: `app.init()` no lanza. Esto valida que **todos** los providers se
  resuelven (controladores, servicios, guards, config).
- Valor: si alguien añade un servicio sin proveerlo, este test falla aquí y no en
  producción.

### 1.2 Health endpoint
- Añadir un `GET /api/health` trivial (si no existe) que devuelva `{ status: 'ok' }`.
- Test: `supertest` → 200. Sirve además como sonda de readiness en el deploy.

### 1.3 Validación de configuración requerida
`src/config/__tests__/env-validation.spec.ts`
- Probar la función `validate` de `ConfigModule` (la que está en `load`/`validate`)
  con un objeto de env mínimo válido → no lanza; y con uno incompleto → lanza.
- Previene deploys con `.env` mal formado.

---

## 6. Tier 2 — Unit tests (lógica pura + servicios mockeados)

Sin DB. Mockear repos con objetos `{ find, findOne, save, count, createQueryBuilder }`.

### Prioridad ALTA — incluye regresiones que YA arreglamos

| Archivo de test | Qué cubre | Regresión que protege |
|---|---|---|
| `modules/auth/auth.controller.spec.ts` | `login()` lee `process.env.AUTH_PASSWORD` **en cada request**; 200 con correcto, 401 con incorrecto. Setear `process.env.AUTH_PASSWORD` en el test tras importar el módulo. | Bug env leído a nivel de módulo |
| `modules/contacts/.../contacts.service.spec.ts` | `create`: nombre duplicado **permitido**; email/teléfono duplicado → `ValidationException` con mensaje **en español**; pasa `EntityManager` opcional y usa `manager.getRepository`. | Unicidad de nombre relajada + i18n + soporte transacción |
| `modules/leads/.../lead-numbering.service.spec.ts` | `generateLeadNumber` para CONSTRUCTION/ROOFING/PLUMBING (formato `NNN-MMYY`, `NNNR-…`, `NNNP-…`); `applyDefaults` rechaza leadNumber existente. | Generación de número de lead |
| `modules/leads/.../leads.service.spec.ts` | `createLeadWithNewContact` envuelve en `dataSource.transaction`; si `persistLead` lanza, **el contacto no se persiste** (verificar que el callback de la transacción propaga el error). | Rollback de contacto huérfano |
| `common/filters/global-exception.filter.spec.ts` | Mapea `ValidationException`→400+`code:VALIDATION_ERROR`; `QueryFailedError`→400+`DATABASE_ERROR`; `HttpException`→status correcto; `Error`→500. | Contrato de error que consume el frontend |

### Prioridad MEDIA
- Mappers (`lead.mapper`, `contact.mapper`, `project.mapper`): entity↔dto sin pérdida de campos.
- `analytics-overview.service`: cálculo de winRate (won/(won+lost), división por cero → 0).
- `s3.service`: validaciones puras (path traversal, `fileName` inválido, `contentType` requerido) — mockear cliente S3.

---

## 7. Tier 3 — Integración (servicio real + DB efímera)

Usar **Testcontainers Postgres** (contenedor desechable, idéntico a prod, sin tocar
Supabase). Patrón:
- `test/setup/pg-testcontainer.ts`: levanta Postgres, crea `DataSource` con
  `synchronize: true` sobre las entidades, expone helpers de limpieza (`TRUNCATE`).
- Cada suite obtiene un `TestingModule` con el `DataSource` del contenedor.

### Casos clave
1. **Lead + contacto (transacción real)** `test/integration/lead-new-contact.int-spec.ts`
   - Éxito → existen 1 lead y 1 contacto.
   - Forzar fallo del lead (projectType inexistente) → **0 contactos** en la tabla (rollback verificado a nivel de BD, no solo de código).
2. **Unicidad de contacto**: dos contactos mismo nombre → OK; mismo email/teléfono → `ValidationException`.
3. **Proyecto → WON (transacción)** `test/integration/project-won.int-spec.ts`
   - Crear proyecto para un lead `NEW_LEAD` → lead pasa a `WON` y existe el proyecto (ambos persistidos atómicamente). Mockear `MailService` para no enviar correo.

---

## 8. Tier 4 — E2E (supertest contra app completa)

`test/e2e/*.e2e-spec.ts`, app real con DB de testcontainers, servicios externos
mockeados (`MailService`, `S3Service`, QuickBooks, Trello).

Flujos mínimos a cubrir (los que romperían el negocio si fallan en deploy):
1. `POST /api/auth/login` (correcto/incorrecto).
2. `POST /api/leads/new-contact` (happy path → 201; email inválido → 400; duplicado teléfono → 400 con `code:VALIDATION_ERROR`).
3. `POST /api/leads/existing-contact`.
4. `PUT /api/leads/:id` con status WON → crea proyecto + (mock) dispara mail.
5. `POST /api/projects` → marca lead WON.
6. `DELETE /api/leads/:id?deleteContact=true`.

> **Importante (mail):** en todos los tests, mockear `MailService.sendMail` y
> **assertar el destinatario** (`info@…` + `david.theran03@gmail.com`) sin enviar
> correos reales. Esto cubre la regresión del cambio de destinatario WON.

---

## 9. CI / Gate de deploy (GitHub Actions)

`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm run test:unit
      # Tier 3/4 (testcontainers) en job aparte; requiere Docker en el runner.
```
- El deploy (Railway/Render/VPS — definir) debe estar **condicionado** a que este
  workflow pase en la rama de producción.
- Añadir un **health check** post-deploy (`GET /api/health`) para abortar si el
  contenedor no levanta.

---

## 10. Plan de implementación por fases

| Fase | Entregable | Esfuerzo | Prioridad |
|---|---|---|---|
| **F0** | Script `verify`, separar configs Jest, CI con Tier 0 | 0.5 día | 🔴 Crítica |
| **F1** | Boot test (DI) + `/health` + test de `validate` env | 0.5 día | 🔴 Crítica |
| **F2** | Unit de prioridad ALTA (tabla §6, incluye regresiones) | 1.5 días | 🟠 Alta |
| **F3** | Testcontainers + integración lead/contacto/proyecto | 1.5 días | 🟡 Media |
| **F4** | E2E supertest de los 6 flujos | 1 día | 🟡 Media |
| **F5** | Mappers, analytics, S3, cobertura ≥60% en módulos core | 1 día | 🟢 Baja |

---

## 11. Criterios de aceptación

- [ ] `npm run verify` pasa localmente y en CI.
- [ ] El test de boot falla si se rompe el grafo DI.
- [ ] Existen tests de regresión para: env-en-request (auth), rollback de contacto, unicidad relajada de nombre, mensajes en español, destinatario WON.
- [ ] E2E cubre los 6 flujos del §8 sin enviar correos reales.
- [ ] CI bloquea el merge/deploy si algo falla.
- [ ] Cobertura objetivo: ≥60% global, ≥80% en `leads`, `contacts`, `auth`, `common/filters`.

---

## 12. Notas / riesgos conocidos a cubrir con tests

- **Concurrencia en `generateLeadNumber`**: calcula `max+1` leyendo todos los números; dos creaciones simultáneas pueden colisionar. Añadir test de concurrencia (2 requests en paralelo) para documentar/forzar la solución (constraint único + retry).
- **`enableImplicitConversion`**: cubrir que `projectTypeId` string→number funciona y que un valor no numérico se rechaza.
- **No depender de Supabase en CI**: toda la suite debe correr con testcontainers o mocks; nunca contra la BD real.
