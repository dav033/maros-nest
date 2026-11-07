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

const attachment = z.discriminatedUnion('kind', [
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

export function registerGoogleWorkspaceTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'create_draft_with_attachment',
    `Crea un BORRADOR en el Gmail de esa persona, con adjuntos opcionales (el documento original de un invoice scan, o contenido en base64). Nunca envía: la persona lo revisa y lo manda desde Gmail. Cuerpo en text o en html, uno solo. Máximo ${MAX_ATTACHMENTS} adjuntos y 20 MB en total. Adjuntar facturas exige permiso finance:read de esa persona.`,
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
    `Guarda un informe en el Drive de esa persona, dentro de Maros/Reports/<subcarpetas> (la carpeta la crea la app; no toca nada más de su Drive). Contenido en text o en contentBase64, hasta 10 MB. Con key, guardar dos veces lo mismo en la misma carpeta no duplica: devuelve el archivo existente (alreadyExisted: true). Subcarpetas: máximo ${MAX_FOLDER_DEPTH - 1} niveles.`,
    {
      userId,
      name: z.string().trim().min(1).max(150).refine(noLineBreaks, 'Sin saltos de línea'),
      contentType,
      text: z.string().min(1).max(10_000_000).optional(),
      contentBase64: z.string().min(1).max(14_000_000).optional(),
      folder: z.array(folderPart).max(MAX_FOLDER_DEPTH - 1).optional(),
      key: z.string().trim().min(1).max(120).refine(noLineBreaks, 'Sin saltos de línea').optional(),
    },
    async ({ userId: id, ...input }: { userId: number } & SaveReportInput) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.saveReportToDrive(user, input);
    },
  );

  registerMcpTool(
    server,
    'save_invoice_to_receipts',
    'Copia el documento original de un invoice scan al Drive de esa persona, en Maros/Receipts/<proyecto>/, con nombre fecha_proveedor_número. Es idempotente: archivar la misma factura otra vez devuelve el archivo existente. Exige permiso finance:write de esa persona. No modifica el scan ni QuickBooks.',
    {
      userId,
      invoiceScanId: z.string().uuid().describe('ID del document scan'),
      project: projectNumber.optional().describe('Carpeta de proyecto; por defecto, el proyecto del scan o Unassigned'),
    },
    async ({ userId: id, ...input }: { userId: number } & SaveReceiptInput) => {
      const user = await deps.mcpActor.userAs(id);
      return deps.googleWorkspaceService.saveInvoiceToReceipts(user, input);
    },
  );
}
