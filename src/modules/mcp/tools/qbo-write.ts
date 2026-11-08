import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ATTACHABLE_ENTITY_TYPES,
  AttachableEntityType,
  NOTE_ENTITY_TYPES,
  NoteEntityType,
  MAX_PRIVATE_NOTE,
} from '../../quickbooks/services/write/qbo-write.utils';
import { McpToolDeps } from './shared';
import { realmIdParam, resolveRealmId } from './qbo-tool-utils';
import { registerMcpTool } from './tool-registration';

/**
 * Basic QuickBooks writes. The rule for all of them: preview first, act only with
 * `confirm: true`, and never change an amount, account, vendor or date of an
 * existing transaction, nor delete or void anything. The MCP calls the service
 * without Nest's ValidationPipe, so these schemas are the input validation.
 */

const qboId = z.string().regex(/^\d{1,20}$/, 'El id de QuickBooks debe ser numérico');
const confirm = z
  .boolean()
  .default(false)
  .describe('false (por defecto) solo muestra qué haría; true lo ejecuta de verdad');

export function registerQboWriteTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'qbo_attach_invoice_scan_file',
    `Adjunta el documento original de un invoice scan a una transacción de QuickBooks (${ATTACHABLE_ENTITY_TYPES.join(', ')}). Solo AÑADE un documento: no cambia importes ni cuentas. Sin confirm devuelve la vista previa (archivo, tamaño, transacción); con confirm: true lo sube. Si la transacción ya tiene un adjunto con el mismo nombre no lo repite. Verifica que la transacción exista. PDF/JPG/PNG/WebP de hasta 5 MB.`,
    {
      invoiceScanId: z.string().uuid().describe('ID del document scan'),
      entityType: z.enum(ATTACHABLE_ENTITY_TYPES),
      entityId: qboId.describe('Id de la transacción en QuickBooks'),
      confirm,
      realmId: realmIdParam,
    },
    async ({
      invoiceScanId,
      entityType,
      entityId,
      confirm: run,
      realmId,
    }: {
      invoiceScanId: string;
      entityType: AttachableEntityType;
      entityId: string;
      confirm: boolean;
      realmId?: string;
    }) =>
      deps.qboWriteService.attachScanFile(await resolveRealmId(deps, realmId), {
        invoiceScanId,
        entityType,
        entityId,
        confirm: run === true,
      }),
  );

  registerMcpTool(
    server,
    'qbo_update_transaction_note',
    `Añade (append, por defecto) o reemplaza (replace) la nota privada (memo interno) de una transacción de QuickBooks (${NOTE_ENTITY_TYPES.join(', ')}). Solo toca ese campo: nunca importes, cuentas, proveedor ni fechas. Sin confirm devuelve la nota actual y la nueva; con confirm: true la guarda (actualización parcial con SyncToken, así no pisa cambios hechos mientras tanto). Máximo ${MAX_PRIVATE_NOTE} caracteres.`,
    {
      entityType: z.enum(NOTE_ENTITY_TYPES),
      entityId: qboId.describe('Id de la transacción en QuickBooks'),
      note: z.string().trim().min(1).max(1000).describe('Texto de la nota'),
      mode: z.enum(['append', 'replace']).default('append'),
      confirm,
      realmId: realmIdParam,
    },
    async ({
      entityType,
      entityId,
      note,
      mode,
      confirm: run,
      realmId,
    }: {
      entityType: NoteEntityType;
      entityId: string;
      note: string;
      mode?: 'append' | 'replace';
      confirm: boolean;
      realmId?: string;
    }) =>
      deps.qboWriteService.updatePrivateNote(await resolveRealmId(deps, realmId), {
        entityType,
        entityId,
        note,
        mode: mode ?? 'append',
        confirm: run === true,
      }),
  );

  registerMcpTool(
    server,
    'qbo_preview_bill_from_scan',
    'Muestra el Bill que saldría de un invoice scan (proveedor, fechas, número, línea de gasto) y todo lo que lo bloquea (proveedor sin emparejar, cuenta sin elegir, ya registrada, sin total o fecha) y si ya existe un Bill con ese número para el proveedor. NO crea nada en QuickBooks: la creación aún no está habilitada hasta confirmar las reglas contables. La cuenta de gasto nunca se adivina: hay que pasarla en accountId.',
    {
      invoiceScanId: z.string().uuid().describe('ID del document scan'),
      accountId: qboId.optional().describe('Id de la cuenta de gasto en QuickBooks'),
      realmId: realmIdParam,
    },
    async ({ invoiceScanId, accountId, realmId }: { invoiceScanId: string; accountId?: string; realmId?: string }) =>
      deps.qboWriteService.previewBill(await resolveRealmId(deps, realmId), { invoiceScanId, accountId }),
  );
}
