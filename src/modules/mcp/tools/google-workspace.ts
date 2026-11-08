import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_FOLDER_DEPTH,
} from '../../google-workspace/workspace-input';
import {
  CreateDraftInput,
  SaveReceiptInput,
  SaveReportInput,
} from '../../google-workspace/google-workspace.service';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Gmail drafts and Drive files, done as a connected person.
 *
 * Same rule as Google Calendar: the Google connection belongs to a person, so
 * `userId` is explicit on every call and the draft or file lands in THAT
 * person's account. `McpActorService.userAs` refuses deactivated accounts, and
 * the service checks the finance permissions of that person.
 *
 * The MCP calls the service directly, without Nest's ValidationPipe: the zod
 * schemas below are the only input validation. Drafts are never sent, and files
 * only go to the `Maros` folder the app owns in Drive.
 */

const userId = z
  .number()
  .int()
  .positive()
  .describe('En nombre de quién se actúa: su Gmail/Drive recibe el resultado. Sale de list_users.');

const noLineBreaks = (value: string) => !/[\r\n]/.test(value);

const email = z.string().trim().email().max(254);
const recipients = z.array(email).max(20);
const projectNumber = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{2,10}(-[0-9A-Za-z]{2,10})?$/, 'Número de proyecto inválido, p. ej. 064P-0826');
const folderPart = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(noLineBreaks, 'Sin saltos de línea');
const contentType = z
  .string()
  .refine((value) => ALLOWED_CONTENT_TYPES.has(value), 'Tipo de archivo no permitido');

const driveFileId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,120}$/, 'ID de archivo de Drive inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD');

const attachment = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('drive_file'),
    fileId: driveFileId.describe(
      'ID de un archivo de Drive guardado por Maros (save_report_to_drive / save_invoice_to_receipts). Los Google Docs/Sheets/Slides se adjuntan como PDF.',
    ),
  }),
  z.object({
    kind: z.literal('invoice_scan'),
    id: z.string().uuid().describe('ID del document scan; se adjunta su documento original'),
  }),
  z.object({
    kind: z.literal('inline'),
    fileName: z.string().trim().min(1).max(150).refine(noLineBreaks, 'Sin saltos de línea'),
    contentType,
    contentBase64: z.string().min(1).max(8_000_000).describe('Contenido en base64, máximo 5 MB ya decodificado'),
  }),
]);

const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'Fecha o fecha-hora ISO, p. ej. 2026-11-01');

export function registerGoogleWorkspaceTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'search_drive_files',
    'Busca archivos en el Google Drive de esa persona (solo lectura, no modifica nada). Filtros opcionales: nombre que contiene un texto, tipo MIME, carpeta por id y modificados desde una fecha. Devuelve id, nombre, tipo, tamaño y enlace. `visibility` dice si la búsqueda cubrió TODO el Drive o solo los archivos que Maros guardó (en ese caso, la persona debe reconectar Google). Los ids sirven para adjuntar en create_draft_with_attachment.',
    {
      userId,
      nameContains: z.string().trim().min(1).max(100).refine(noLineBreaks, 'Sin saltos de línea').optional(),
      mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'Tipo MIME inválido').max(100).optional(),
      folderId: driveFileId.optional().describe('Id de una carpeta de Drive'),
      modifiedAfter: isoDateTime.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ userId: id, ...input }: { userId: number; nameContains?: string; mimeType?: string; folderId?: string; modifiedAfter?: string; limit?: number }) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.searchDriveFiles(user, { ...input, limit: input.limit ?? 20 });
    },
  );

  registerMcpTool(
    server,
    'ensure_gmail_label',
    'Crea una etiqueta en el Gmail de esa persona si todavía no existe (p. ej. "Invoices", la que usa import_gmail_invoices_to_receipts). No renombra, edita ni borra etiquetas y no toca ningún correo. Devuelve su id y si se creó o ya existía. Rechaza nombres reservados de Gmail (Inbox, Sent, Trash…). Exige permiso finance:write de esa persona.',
    {
      userId,
      name: z.string().trim().min(1).max(100).refine(noLineBreaks, 'Sin saltos de línea').describe('Nombre de la etiqueta; "Padre/Hijo" crea una anidada'),
    },
    async ({ userId: id, name }: { userId: number; name: string }) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.ensureGmailLabel(user, name);
    },
  );

  registerMcpTool(
    server,
    'import_gmail_invoices_to_receipts',
    'Lee los correos de UNA etiqueta de Gmail de esa persona y guarda los adjuntos de factura (PDF, JPG, PNG, WebP de hasta 5 MB) en Maros/Receipts/_Inbox de su Drive. Solo lee: no etiqueta, archiva, borra ni envía nada, y no toca correos sin esa etiqueta. Es idempotente: un adjunto ya guardado se cuenta como duplicado. Cada archivo lleva en su descripción el correo de origen (id, remitente, asunto, fecha). Devuelve lo guardado con enlaces, los duplicados y lo omitido con el motivo. Exige permiso finance:write de esa persona.',
    {
      userId,
      label: z.string().trim().min(1).max(100).refine(noLineBreaks, 'Sin saltos de línea').describe('Nombre exacto de la etiqueta de Gmail'),
      maxMessages: z.number().int().min(1).max(25).default(10),
      sinceDays: z.number().int().min(1).max(365).optional().describe('Solo correos de los últimos N días'),
    },
    async ({ userId: id, ...input }: { userId: number; label: string; maxMessages?: number; sinceDays?: number }) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.importGmailInvoices(user, { ...input, maxMessages: input.maxMessages ?? 10 });
    },
  );

  registerMcpTool(
    server,
    'create_draft_with_attachment',
    `Crea un BORRADOR en el Gmail de esa persona, con adjuntos opcionales (un archivo de Drive por su id, el documento original de un invoice scan, o contenido en base64). Nunca envía: la persona lo revisa y lo manda desde Gmail. Cuerpo en text o en html, uno solo. Máximo ${MAX_ATTACHMENTS} adjuntos y 20 MB en total. Adjuntar facturas exige permiso finance:read de esa persona.`,
    {
      userId,
      to: recipients.min(1),
      cc: recipients.optional(),
      bcc: recipients.optional(),
      subject: z.string().trim().min(1).max(250).refine(noLineBreaks, 'El asunto no admite saltos de línea'),
      text: z.string().min(1).max(200_000).optional(),
      html: z.string().min(1).max(400_000).optional(),
      attachments: z.array(attachment).max(MAX_ATTACHMENTS).optional(),
    },
    async ({ userId: id, ...input }: { userId: number } & CreateDraftInput) => {
      if ((input.text === undefined) === (input.html === undefined)) {
        throw new Error('Indica el cuerpo como text o como html, uno solo.');
      }
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.createDraftWithAttachment(user, input);
    },
  );

  registerMcpTool(
    server,
    'save_report_to_drive',
    `Guarda un informe en el Drive de esa persona, dentro de Maros/Reports/<subcarpetas> (la carpeta la crea la app; no toca nada más de su Drive). Contenido en text o en contentBase64, hasta 10 MB. Con addDate el nombre lleva la fecha antes de la extensión (informe.pdf -> informe-2026-11-08.pdf). Nunca sobrescribe: si el nombre ya existe en la carpeta, añade -2, -3. Con key, guardar dos veces lo mismo en la misma carpeta no duplica: devuelve el archivo existente (alreadyExisted: true). Subcarpetas: máximo ${MAX_FOLDER_DEPTH - 1} niveles.`,
    {
      userId,
      name: z.string().trim().min(1).max(150).refine(noLineBreaks, 'Sin saltos de línea'),
      contentType,
      text: z.string().min(1).max(10_000_000).optional(),
      contentBase64: z.string().min(1).max(14_000_000).optional(),
      folder: z.array(folderPart).max(MAX_FOLDER_DEPTH - 1).optional(),
      key: z.string().trim().min(1).max(120).refine(noLineBreaks, 'Sin saltos de línea').optional(),
      addDate: z.boolean().optional().describe('Añade la fecha al nombre'),
      date: isoDate.optional().describe('Fecha para addDate; por defecto hoy (hora del Este de EE. UU.)'),
    },
    async ({ userId: id, ...input }: { userId: number } & SaveReportInput) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.saveReportToDrive(user, input);
    },
  );

  registerMcpTool(
    server,
    'save_invoice_to_receipts',
    'Copia el documento original de un invoice scan al Drive de esa persona, en Maros/Receipts/<proyecto>/, con el nombre estándar Proyecto-Proveedor-Valor (064P-HomeDepot-1250.00.pdf). Si falta proyecto, proveedor o importe NO guarda nada y dice qué falta (pásalos en project, vendor o amount); si el nombre ya existe añade -2, -3 y nunca sobrescribe. Es idempotente: archivar la misma factura otra vez devuelve el archivo existente. Exige permiso finance:write de esa persona. No modifica el scan ni QuickBooks.',
    {
      userId,
      invoiceScanId: z.string().uuid().describe('ID del document scan'),
      project: projectNumber.optional().describe('Proyecto; por defecto, el del scan'),
      vendor: z.string().trim().min(2).max(80).refine(noLineBreaks, 'Sin saltos de línea').optional().describe('Proveedor; por defecto, el leído en la factura'),
      amount: z.number().finite().min(0).max(100_000_000).optional().describe('Importe; por defecto, el total leído en la factura'),
    },
    async ({ userId: id, ...input }: { userId: number } & SaveReceiptInput) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.saveInvoiceToReceipts(user, input);
    },
  );
}
