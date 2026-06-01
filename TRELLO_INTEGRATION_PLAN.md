# Plan de integración Trello → MCP

> Plan ejecutable por un agente IA. Cada sección dice **qué archivo tocar**, **qué código escribir** y **cómo verificar**. No agregar lógica fuera del scope listado.

---

## 0. Objetivo

Exponer Trello como un conjunto de herramientas dentro del servidor MCP (`maros-nest/src/modules/mcp`) para que el LLM que consume el MCP pueda:

- Resolver nombres de personas → `idMember` de Trello.
- Resolver nombres/contextos de listas → `idList` de Trello.
- Crear tarjetas (tareas) en Trello con asignados, fecha límite y descripción.
- Leer/actualizar tarjetas existentes.

El flujo natural del usuario es:

```
Usuario en chat:
  "Genera dos tareas, una asignada a Juan que diga «llamar al cliente»
   y otra asignada a Pedro y Ana que diga «cotizar materiales». Revisa
   el proyecto C-024 para más contexto."

LLM (vía MCP):
  1. get_project_by_lead_number("C-024")          ← ya existe
  2. trello_list_members()                         ← NUEVA
  3. trello_list_boards()  / trello_list_lists()   ← NUEVAS (para resolver lista destino)
  4. trello_create_card({name, idList, idMembers, desc, due})  ← NUEVA (x2)
```

El LLM hace todo el match nombre→id; el backend solo expone primitivas.

---

## 1. Variables de entorno

Las dos variables ya las da el cliente:

| Variable            | Uso                                       |
| ------------------- | ----------------------------------------- |
| `TRELLO_API_KEY`    | Auth en query `?key=...`                  |
| `TRELLO_SECRET_KEY` | Token estático de Trello en `?token=...`  |

Autenticación directa con `key` + `token` en query string. No hay OAuth, no hay refresh, no hay flujos de callback.

### 1.1 Registrar en `src/config/env.validation.ts`

Dentro de `EnvironmentVariables`, después del bloque `// Supabase` (o donde quepa), agregar:

```ts
// Trello
@IsString()
@IsOptional()
TRELLO_API_KEY: string;

@IsString()
@IsOptional()
TRELLO_SECRET_KEY: string;
```

Ambas `@IsOptional()` para no romper boot si aún no están seteadas en dev. En `validate()`, agregar al bloque de producción la verificación si `NODE_ENV === production`:

```ts
const missingTrelloConfig = ['TRELLO_API_KEY', 'TRELLO_SECRET_KEY']
  .filter((key) => !normalizedConfig[key]);

if (isProduction && missingTrelloConfig.length > 0) {
  throw new Error(
    `Missing required Trello configuration: ${missingTrelloConfig.join(', ')}`,
  );
}
```

---

## 2. Config provider

**Crear** `src/config/trello.config.ts`:

```ts
import { registerAs } from '@nestjs/config';

export interface TrelloConfig {
  apiKey: string;
  token: string;
  apiBase: string;
}

export default registerAs(
  'trello',
  (): TrelloConfig => ({
    apiKey: process.env.TRELLO_API_KEY || '',
    token: process.env.TRELLO_SECRET_KEY || '',
    apiBase: 'https://api.trello.com/1',
  }),
);
```

**Cargar en** `src/app.module.ts`:

```ts
import trelloConfig from './config/trello.config';
// ...
load: [n8nConfig, trelloConfig],
```

---

## 3. Módulo Trello

**Crear** `src/modules/trello/` con la siguiente estructura:

```
src/modules/trello/
├── trello.module.ts
├── services/
│   └── trello.service.ts
└── dto/
    └── trello.dto.ts
```

### 3.1 `trello.module.ts`

```ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TrelloService } from './services/trello.service';
import trelloConfig from '../../config/trello.config';

@Module({
  imports: [HttpModule, ConfigModule.forFeature(trelloConfig)],
  providers: [TrelloService],
  exports: [TrelloService],
})
export class TrelloModule {}
```

### 3.2 `dto/trello.dto.ts`

Solo tipos planos (sin class-validator, no son DTOs de HTTP, son contratos internos):

```ts
export interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
}

export interface TrelloBoard {
  id: string;
  name: string;
  closed: boolean;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
  closed: boolean;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idBoard: string;
  due: string | null;
  idMembers: string[];
  url: string;
  shortUrl: string;
}

export interface CreateTrelloCardInput {
  idList: string;
  name: string;
  desc?: string;
  due?: string;            // ISO 8601
  idMembers?: string[];    // ids resueltos por el LLM antes de llamar
  pos?: 'top' | 'bottom';
}

export interface UpdateTrelloCardInput {
  name?: string;
  desc?: string;
  due?: string | null;
  idList?: string;
  closed?: boolean;
  idMembers?: string[];
}
```

### 3.3 `services/trello.service.ts`

Pattern: idéntico al `ClickUpService` que acabamos de borrar (referencia git si hace falta). Usa `HttpService` de `@nestjs/axios` con `firstValueFrom`. Auth en query con `key` + `token`.

Esqueleto:

```ts
import { HttpService } from '@nestjs/axios';
import { ConfigType } from '@nestjs/config';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import trelloConfig from '../../../config/trello.config';
import { ExternalServiceException } from '../../../common/exceptions';
import {
  TrelloMember,
  TrelloBoard,
  TrelloList,
  TrelloCard,
  CreateTrelloCardInput,
  UpdateTrelloCardInput,
} from '../dto/trello.dto';

@Injectable()
export class TrelloService {
  private readonly logger = new Logger(TrelloService.name);

  constructor(
    @Inject(trelloConfig.KEY)
    private readonly config: ConfigType<typeof trelloConfig>,
    private readonly httpService: HttpService,
  ) {}

  // === Boards ===
  async listBoardsForMe(): Promise<TrelloBoard[]> {
    return this.get<TrelloBoard[]>(`/members/me/boards`, {
      fields: 'id,name,closed,url',
      filter: 'open',
    });
  }

  // === Lists ===
  async listListsByBoard(boardId: string): Promise<TrelloList[]> {
    return this.get<TrelloList[]>(`/boards/${boardId}/lists`, {
      fields: 'id,name,idBoard,closed',
      filter: 'open',
    });
  }

  // === Members ===
  async listMembersByBoard(boardId: string): Promise<TrelloMember[]> {
    return this.get<TrelloMember[]>(`/boards/${boardId}/members`, {
      fields: 'id,fullName,username',
    });
  }

  async getMe(): Promise<TrelloMember> {
    return this.get<TrelloMember>(`/members/me`, {
      fields: 'id,fullName,username',
    });
  }

  // === Cards ===
  async createCard(input: CreateTrelloCardInput): Promise<TrelloCard> {
    return this.post<TrelloCard>(`/cards`, {
      idList: input.idList,
      name: input.name,
      desc: input.desc,
      due: input.due,
      idMembers: input.idMembers?.join(','),
      pos: input.pos ?? 'bottom',
    });
  }

  async getCard(cardId: string): Promise<TrelloCard> {
    return this.get<TrelloCard>(`/cards/${cardId}`);
  }

  async updateCard(cardId: string, input: UpdateTrelloCardInput): Promise<TrelloCard> {
    return this.put<TrelloCard>(`/cards/${cardId}`, {
      ...input,
      idMembers: input.idMembers?.join(','),
    });
  }

  async deleteCard(cardId: string): Promise<void> {
    await this.delete(`/cards/${cardId}`);
  }

  async listCardsByList(listId: string): Promise<TrelloCard[]> {
    return this.get<TrelloCard[]>(`/lists/${listId}/cards`);
  }

  // === HTTP helpers ===
  private authParams() {
    return { key: this.config.apiKey, token: this.config.token };
  }

  private async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.exec<T>(() =>
      this.httpService.get<T>(`${this.config.apiBase}${path}`, {
        params: { ...this.authParams(), ...params },
      }),
      `GET ${path}`,
    );
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.exec<T>(() =>
      this.httpService.post<T>(`${this.config.apiBase}${path}`, null, {
        params: { ...this.authParams(), ...body },
      }),
      `POST ${path}`,
    );
  }

  private async put<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.exec<T>(() =>
      this.httpService.put<T>(`${this.config.apiBase}${path}`, null, {
        params: { ...this.authParams(), ...body },
      }),
      `PUT ${path}`,
    );
  }

  private async delete(path: string): Promise<void> {
    await this.exec(() =>
      this.httpService.delete(`${this.config.apiBase}${path}`, {
        params: this.authParams(),
      }),
      `DELETE ${path}`,
    );
  }

  private async exec<T>(
    call: () => ReturnType<HttpService['get']>,
    label: string,
  ): Promise<T> {
    try {
      const resp = (await firstValueFrom(call())) as AxiosResponse<T>;
      return resp.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      this.logger.error(`Trello ${label} failed [${status}]: ${JSON.stringify(body)}`);
      throw new ExternalServiceException(
        `Trello ${label} failed: ${err?.message ?? 'unknown'}`,
        'Trello',
        err,
      );
    }
  }
}
```

> Trello acepta los parámetros tanto en query como en body. Para mantenerse simple usar **query string** en todos los verbos (es lo que recomienda su doc para POST/PUT) — pasa los params via `axios.params` y deja el body en `null`.

---

## 4. Registro en MCP

### 4.1 `src/modules/mcp/tools/trello.ts` (nuevo)

Sigue el patrón de `tools/crm-read.ts` y `tools/qbo-proxy.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';

export function registerTrelloTools(server: McpServer, deps: McpToolDeps) {
  server.tool(
    'trello_list_boards',
    'List all open Trello boards the workspace token has access to. Use this to find the board where tasks should be created.',
    {},
    async () => jsonContent(await deps.trelloService.listBoardsForMe()),
  );

  server.tool(
    'trello_list_lists',
    'List all open lists (columns) in a Trello board. Use this to find the idList for creating a card (e.g. "To Do", "In Progress").',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }) =>
      jsonContent(await deps.trelloService.listListsByBoard(boardId)),
  );

  server.tool(
    'trello_list_members',
    'List members of a Trello board (id, fullName, username). Use this to map a person mentioned by the user (e.g. "Juan", "Ana") to a Trello idMember before creating/assigning cards.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }) =>
      jsonContent(await deps.trelloService.listMembersByBoard(boardId)),
  );

  server.tool(
    'trello_create_card',
    'Create a Trello card (task) in a list. Resolve idList via trello_list_lists and idMembers via trello_list_members BEFORE calling this.',
    {
      idList: z.string().describe('Target Trello list id'),
      name: z.string().describe('Card title'),
      desc: z.string().optional().describe('Card description / body (markdown supported)'),
      due: z.string().optional().describe('Due date in ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)'),
      idMembers: z
        .array(z.string())
        .optional()
        .describe('Trello member ids to assign. Resolve names → ids via trello_list_members.'),
      pos: z.enum(['top', 'bottom']).optional().describe('Position in list'),
    },
    async (input) => jsonContent(await deps.trelloService.createCard(input)),
  );

  server.tool(
    'trello_get_card',
    'Get a Trello card by id.',
    { cardId: z.string() },
    async ({ cardId }) => jsonContent(await deps.trelloService.getCard(cardId)),
  );

  server.tool(
    'trello_update_card',
    'Update an existing Trello card (rename, change due date, reassign members, move list, archive).',
    {
      cardId: z.string(),
      name: z.string().optional(),
      desc: z.string().optional(),
      due: z.string().nullable().optional().describe('ISO date or null to clear'),
      idList: z.string().optional().describe('Move card to this list'),
      closed: z.boolean().optional().describe('Archive (true) or unarchive (false)'),
      idMembers: z.array(z.string()).optional().describe('Replace assigned members'),
    },
    async ({ cardId, ...rest }) =>
      jsonContent(await deps.trelloService.updateCard(cardId, rest)),
  );

  server.tool(
    'trello_delete_card',
    'Permanently delete a Trello card.',
    { cardId: z.string() },
    async ({ cardId }) => {
      await deps.trelloService.deleteCard(cardId);
      return jsonContent({ deleted: true, cardId });
    },
  );

  server.tool(
    'trello_list_cards_by_list',
    'List all cards currently in a given Trello list.',
    { listId: z.string() },
    async ({ listId }) =>
      jsonContent(await deps.trelloService.listCardsByList(listId)),
  );
}
```

### 4.2 Extender `McpToolDeps`

En `src/modules/mcp/tools/shared.ts`:

```ts
import { TrelloService } from '../../trello/services/trello.service';
// ...
export type McpToolDeps = {
  // ... campos existentes
  trelloService: TrelloService;
};
```

### 4.3 Inyectar y registrar en `mcp.service.ts`

- Importar `TrelloService` y `registerTrelloTools`.
- Agregar al constructor: `private readonly trelloService: TrelloService`.
- Agregar al objeto `deps`: `trelloService: this.trelloService`.
- Llamar `registerTrelloTools(server, deps);` al final del bloque de `register*`.

### 4.4 `mcp.module.ts`

Importar `TrelloModule`:

```ts
import { TrelloModule } from '../trello/trello.module';
// ...
imports: [LeadsModule, CompaniesModule, ContactsModule, ProjectsModule, QuickbooksModule, TrelloModule],
```

---

## 5. Flujo conversacional esperado (referencia, no se codea)

Cuando el usuario diga algo como:

> "Genera dos tareas en Trello, una asignada a Juan que diga «llamar al cliente» y otra a Pedro y Ana que diga «cotizar materiales». Revisa el proyecto C-024 para contexto."

El LLM debe internamente:

1. `get_project_by_lead_number({ leadNumber: "C-024" })` → contexto del proyecto.
2. `trello_list_boards()` → identificar board operativo (puede cachearse en el sistema prompt si siempre es el mismo).
3. `trello_list_lists({ boardId })` → encontrar lista "To Do" o equivalente.
4. `trello_list_members({ boardId })` → resolver Juan, Pedro, Ana → ids.
5. `trello_create_card({ idList, name: "Llamar al cliente", desc: <contexto C-024>, idMembers: [juanId] })`.
6. `trello_create_card({ idList, name: "Cotizar materiales", desc: <contexto C-024>, idMembers: [pedroId, anaId] })`.

**No** se implementa parser de NL en el backend. Toda la inteligencia vive en el LLM que consume el MCP. El backend solo expone primitivas.

---

## 6. Manejo de errores

- Toda llamada externa va por `TrelloService.exec()` que lanza `ExternalServiceException` con `service='Trello'`.
- Esa excepción ya es manejada por `GlobalExceptionFilter` (ver `src/common/filters/global-exception.filter.ts`).
- En tools MCP no se necesita try/catch — si el service lanza, MCP propaga el error como respuesta de tool fallida y el LLM puede reaccionar.

---

## 7. Checklist de implementación (orden sugerido)

1. [ ] Crear `src/config/trello.config.ts`.
2. [ ] Editar `src/config/env.validation.ts` (campos + validación prod).
3. [ ] Editar `src/app.module.ts` (cargar config).
4. [ ] Crear `src/modules/trello/dto/trello.dto.ts`.
5. [ ] Crear `src/modules/trello/services/trello.service.ts`.
6. [ ] Crear `src/modules/trello/trello.module.ts`.
7. [ ] Editar `src/modules/mcp/tools/shared.ts` (agregar `trelloService` en `McpToolDeps`).
8. [ ] Crear `src/modules/mcp/tools/trello.ts`.
9. [ ] Editar `src/modules/mcp/mcp.service.ts` (inyectar service + registrar tools).
10. [ ] Editar `src/modules/mcp/mcp.module.ts` (importar `TrelloModule`).
11. [ ] `npx tsc --noEmit` debe pasar sin errores.
12. [ ] Probar con `.env.local` real: `curl` al endpoint `/api/mcp` y verificar que `tools/list` incluye los `trello_*`.

---

## 8. Variables `.env.local` (ejemplo)

```
TRELLO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TRELLO_SECRET_KEY=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

---

## 9. Out of scope (NO hacer en esta entrega)

- Persistencia de boards/listas/cards en base de datos.
- UI en `maros-next`.
- Webhooks de Trello hacia el backend.
- Sincronización bidireccional con leads/projects del CRM.
