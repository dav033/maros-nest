# Plan de migración a una app móvil Flutter

Fecha: 2026-09-27
Amplía la §6 del plan maestro. Sustituye a ese apartado.

---

## 0. La decisión de alcance, primero

**La app móvil no debe ser el CRM.** Portar analytics, el editor de notas TipTap, la gestión de roles y los tableros de tareas a Dart es coste sin retorno: esas pantallas se usan sentado, con teclado y monitor, y ya funcionan.

Lo que sí cambia con un móvil en la mano es el trabajo **en obra**, y en concreto hay una función que hoy está artificialmente bloqueada:

> **Escanear facturas.** El pipeline ya existe entero en el backend: `POST /invoice-scans` devuelve una URL S3 prefirmada, el cliente sube el archivo, `POST /invoice-scans/:id/scan` lo manda a OpenAI con salida estructurada y devuelve los campos extraídos más sugerencias de proveedor y cuenta de QuickBooks. Todo eso está construido y probado. Lo único que falta es la entrada natural: **la cámara del teléfono**. Hoy alguien tiene que llevar el papel a una mesa, escanearlo y subirlo desde un navegador de escritorio. Hay un cron diario a las 8:00 que manda recordatorios de facturas sin teclear — ese recordatorio existe porque el paso manual se atasca.

Ese es el argumento de la app, no «tener el CRM en el móvil».

**Alcance propuesto, en orden de valor:**

| | Pantalla | Por qué en móvil |
|---|---|---|
| 1 | Capturar factura con la cámara | Elimina el viaje papel → escritorio. El backend ya lo soporta |
| 2 | Mis tareas (hoy / vencidas) + marcar hecha | `GET /tasks/mine` ya existe y ya está paginado |
| 3 | Ficha de proyecto en modo consulta | Contacto, dirección con enlace a navegación, adjuntos, la línea de dinero en lectura |
| 4 | Subir fotos a un proyecto o tarea | Parte de obra visual; hoy exige escritorio |
| 5 | Notificaciones | Requiere push, que hoy no existe (fase 4) |

Fuera de alcance: analytics, notas, roles, importación de QuickBooks, reportes.

---

## 1. El bloqueante real: la sesión no la emite el backend

Esto es lo que hay que resolver antes de escribir una línea de Dart. No es una preferencia arquitectónica: es que **hoy no existe ninguna forma de que un cliente que no sea un navegador obtenga una sesión.**

### 1.1 Cómo funciona hoy

```
Navegador ──▶ maros-next /api/auth/google          (construye la URL de Google)
          ──▶ Google                                (consentimiento)
          ──▶ maros-next /api/auth/google/callback  (verifica id_token contra el JWKS,
                                                     comprueba dominio o invitación,
                                                     FIRMA el JWT de sesión con AUTH_SECRET,
                                                     y lo pone en la cookie maros_session)
          ──▶ maros-nest                            (SessionAuthGuard SOLO lee esa cookie)
```

Tres consecuencias:

1. **La emisión de sesión vive en Next.js**, no en Nest. Nest solo verifica. Las dos apps comparten `AUTH_SECRET` como secreto simétrico.
2. **`SessionAuthGuard` nunca lee `Authorization`.** Los dos guardias que sí usan bearer —`IntakeTokenGuard` y `McpAuthGuard`— son secretos estáticos de máquina, no autenticación de usuario.
3. **No hay refresh.** El JWT es plano, de 30 días, y la única forma de renovarlo es otra vuelta completa de OAuth por el navegador.

Una app Flutter no puede pasar por Next.js: las rutas de Next son parte del renderizado de esa aplicación, no una API.

### 1.2 Lo que ya juega a favor

- El JWT **ya es portable**: se verifica con `jose` y `AUTH_SECRET`, sin estado de servidor.
- `serverApiClient.ts:189-198` **ya reenvía la cabecera `Authorization`** al backend. La tubería está medio puesta; lo que falta es que el guardia la lea.
- `SessionAuthGuard` **relee el usuario de la base de datos en cada petición** (`UsersService.resolveForRequest`) en vez de confiar en los claims del token. Eso significa que desactivar a alguien surte efecto inmediato. **Esta propiedad hay que conservarla**: es la que permite que un token de vida corta no sea imprescindible para la revocación.

### 1.3 El rediseño

**Mover la emisión de sesión a Nest, y que Next pase a consumir esa misma ruta.** No dos implementaciones.

| Ruta nueva en Nest | Qué hace |
|---|---|
| `POST /auth/google` | Recibe el `id_token` del SDK nativo de Google (o del navegador), lo verifica contra el JWKS de Google, aplica la misma regla de admisión que hoy (dominio de Workspace **o** invitación en base de datos), y devuelve `{ accessToken, refreshToken, expiresIn, user }` |
| `POST /auth/refresh` | Canjea un refresh token por un par nuevo. Rotativo: el usado se invalida |
| `POST /auth/logout` | Revoca el refresh token presentado |

- **Access token**: 15 minutos, mismo formato que el JWT actual para no romper nada.
- **Refresh token**: opaco, persistido **solo como hash** (misma utilidad `share-token.util.ts` que ya se usa para los enlaces de notas y para las invitaciones), con `expires_at`, `revoked_at` y `device_label`. Rotación en cada uso.
- **`SessionAuthGuard` acepta ambos**: cookie (navegador, sin cambios) y `Authorization: Bearer` (móvil). Es un cambio pequeño y aditivo.
- **Next deja de firmar**: su callback llama a `POST /auth/google` y guarda el access token en la cookie. La regla de admisión queda escrita una sola vez, en el backend — que es además donde ya vive la comprobación de invitaciones que se acaba de construir.

**Efecto lateral que interesa:** hoy el middleware de Next solo valida la firma del JWT y nunca pregunta al backend, así que un usuario desactivado conserva navegación en el frontend hasta 30 días (el backend sí lo bloquea, no hay fuga de datos, pero la experiencia es confusa). Con access tokens de 15 minutos ese desfase pasa a ser de 15 minutos.

---

## 2. Lo que hay que subir al backend antes de duplicarlo en Dart

Cada punto de aquí es lógica que hoy vive en el frontend web. Si se escribe una app Flutter sin moverla, se escribe por segunda vez y las dos versiones divergen.

### 2.1 Adjuntos — el caso más claro

Existen **dos** caminos incoherentes:

| | `ManagedFilesController` (Nest) | Server Actions de Next |
|---|---|---|
| Se usa para | Archivos de tareas y workspaces | Adjuntos de leads, proyectos, empresas, contactos, notas |
| Flujo | intent → PUT prefirmado a S3 → complete | presign directo desde Next |
| Esquema de clave | `managed/{ownerKind}/{ownerId}/…` | `mcp/attachments/{kind}/{entityId}/…` |
| Credenciales AWS | En `maros-nest` | **Otra copia en `maros-next`** |
| ¿Lo puede llamar Flutter? | **Sí** | **No** |

Las Server Actions usan el protocolo interno RSC de Next: no son endpoints REST y no se pueden llamar desde otro cliente. Además, guardar el adjunto hace un *read-modify-write* del proyecto entero desde el cliente (`appendProjectAttachmentAction` lee la ficha, mete la clave en el array en JS y hace `PUT` de todo el objeto), lo que es una condición de carrera esperando a pasar.

**Acción:** portar ese flujo a rutas REST de Nest reutilizando `ManagedFilesController`, que ya es móvil-compatible, y retirar el `S3Client` de `maros-next` junto con sus credenciales.

### 2.2 Políticas de dominio en el cliente

`maros-next/src/features/*/domain/**` no son DTOs: hay reglas de negocio. El ejemplo verificado es `leadStatusPolicy.ts:32-52` (`canTransition` / `ensureTransition`), que valida transiciones de estado de lead **y que el backend no replica**: `PUT /leads/:leadId` acepta cualquier transición.

Hoy la matriz es permisiva, así que no hay daño visible. El problema es el patrón: la regla existe en un solo sitio y no es el que manda. Hay que auditar feature por feature y mover las políticas al backend antes de que una tercera implementación las contradiga.

### 2.3 Servicios externos llamados desde Next

- Los **webhooks de n8n** del pipeline de reportes de restauración (subida de imagen, procesado de documento, envío de correo) están cableados como Server Actions con las URLs a fuego y sin autenticación.
- Las llamadas a **OpenAI para traducción** también, con su propia caché en memoria y su propio backoff.

Ninguno de los dos es alcanzable desde Flutter. Están fuera del alcance móvil propuesto, pero conviene saber que existen porque son lógica de negocio fuera del backend.

---

## 3. El contrato: de la API actual a un cliente Dart generado

### 3.1 Lo que falta para poder generar el cliente

1. **`nest-cli.json` no tiene el plugin de `@nestjs/swagger`.** Sin él, Nest no infiere los esquemas de los DTOs a partir de los tipos de TypeScript: un DTO sin `@ApiProperty` explícito se serializa como `{}` en el spec. **Activarlo es una línea** y es lo que más desbloquea.
2. **64 de 96 DTOs** tienen alguna anotación `@ApiProperty`. El tercio restante generará esquemas vacíos.
3. **Módulos enteros sin ninguna anotación**: analytics, google-calendar, managed-files, task-workspaces, task-saved-views, task-templates. `managed-files` es justo el que necesita el móvil para subir fotos.

Con eso resuelto, `/api/docs-json` alimenta un generador (`openapi-generator` o `swagger_dart_code_generator`) y el cliente Dart deja de escribirse a mano.

### 3.2 Paginación — obligatoria antes de que un móvil toque estos endpoints

| Endpoint | Hoy | Riesgo en móvil |
|---|---|---|
| `GET /projects/all` | Sin paginar, con 4 relaciones unidas | ~100 KB por carga |
| `GET /leads` | Sin paginar **y con fan-out a QuickBooks por cada lead** | Latencia y payload escalan con el total |
| `GET /companies/all`, `GET /contacts/all` | Sin paginar | Crece sin techo |
| `GET /crm/customers`, `/crm/clients` | Sin paginar, abanico sobre contactos y empresas | Ídem |

**El patrón ya existe en el repositorio**: el módulo de tareas devuelve `{ items, totalCount, nextCursor }` con paginación real por cursor, y `GET /tasks/board` acota la columna «done» a 30 días o 50 elementos. Replicarlo, no inventarlo.

---

## 4. Fases

| Fase | Contenido | Termina cuando |
|---|---|---|
| **0** | Emisión de sesión en Nest, bearer en `SessionAuthGuard`, access + refresh rotativo. Next pasa a consumir la ruta nueva | Un cliente que no es un navegador puede autenticarse y renovar sin intervención |
| **1** | Adjuntos a REST reutilizando `ManagedFilesController`; retirar el `S3Client` de Next; subir las políticas de dominio | El backend es la única fuente de verdad para escribir |
| **2** | Plugin de Swagger, `@ApiProperty` en los módulos que el móvil usa, paginación por cursor en los cinco endpoints | El cliente Dart se genera y no se mantiene a mano |
| **3** | App Flutter con el alcance de §0: cámara de facturas, mis tareas, ficha de proyecto, fotos | Hay valor real en obra |
| **4** | FCM/APNs y SSE con reconexión manual | Paridad de tiempo real |

**Las fases 0 a 2 son trabajo de backend que mejora también la web.** Ninguna es tirar código a la basura por el móvil.

---

## 5. Decisiones técnicas del lado Flutter (para cuando toque)

- **Tiempo real**: hay un único SSE, `GET /tasks/events/stream`, construido con `@Sse()` y RxJS y consumido en web con el `EventSource` nativo del navegador, que trae reconexión y backoff de fábrica. **Flutter no tiene `EventSource`**: hace falta un paquete y escribir la reconexión a mano. Para la fase 3 basta con sondear; el SSE es fase 4.
- **Notificaciones**: hoy son 100 % por sondeo (`GET /notifications/unread-count`). No existe FCM, APNs ni web-push en ninguna parte del repositorio. Una app sin push no notifica en segundo plano: si eso es un requisito, es trabajo nuevo completo, no una migración.
- **Offline**: `maros-next/src/features/tasks/presentation/offline/` tiene una cola de escrituras que solo existe en el cliente web. En obra la cobertura es mala, así que la app necesita la suya — en Dart, no portable.
- **Base de la API**: `https://api.marosconstruction.com/api`. CORS es irrelevante para un cliente nativo.

---

## 6. Riesgos

1. **El secreto compartido.** Mientras `AUTH_SECRET` sirva para firmar en Next y verificar en Nest, cualquier compromiso de una app compromete la otra. La fase 0 lo reduce a un solo firmante.
2. **Despliegue del backend sin código.** No hay Dockerfile ni IaC en el repositorio; el indicio (`maros-nest-build-dist.tgz` empaquetado a mano) apunta a un despliegue manual. Añadir un cliente móvil aumenta la presión sobre esa pieza: una app publicada en una tienda no se puede revertir tan rápido como un deploy de Netlify.
3. **Tiendas.** Publicar en App Store y Play añade ciclos de revisión que el equipo no tiene hoy. Conviene decidir pronto si la primera versión va por distribución interna (TestFlight / Play interno) en vez de publicación abierta.
4. **Un solo realm de QuickBooks.** `resolveDefaultRealmId()` es literalmente `find({ take: 1 })`. Correcto hoy, silenciosamente incorrecto el día que se conecte una segunda empresa — y un móvil multiplica los sitios donde eso se notaría.

---

## 7. Lo que yo haría primero

La fase 0 no es solo el requisito del móvil: **arregla de paso el desfase de 30 días** entre desactivar a alguien y que el frontend deje de dejarle navegar, y **deja la regla de admisión escrita una sola vez**, en el mismo sitio donde ya vive la comprobación de invitaciones recién construida.

Si la app móvil se aplazara, la fase 0 sigue mereciendo la pena por sí sola.
