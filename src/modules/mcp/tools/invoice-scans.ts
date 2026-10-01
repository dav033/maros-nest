import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

/**
 * Document scans (`invoice_scans`): facturas escaneadas y transacciones escritas
 * a mano, con su cola de revisión.
 *
 * A diferencia del controlador HTTP, acá no corre el ValidationPipe de Nest: el
 * MCP llama al servicio directamente. Por eso los esquemas zod de este archivo
 * replican las reglas de los DTO (`CreateManualInvoiceTransactionDto`,
 * `UpdateInvoiceScanDto`, `AttachInvoiceScanFileDto`) en vez de confiar en que
 * alguien valide más abajo. Si un DTO cambia, estos esquemas cambian con él.
 *
 * Las escrituras hechas por acá quedan **sin autor** (`updated_by = null`): el
 * MCP se autentica con un token compartido, no con la sesión de una persona, así
 * que no hay a quién atribuirlas. En la UI el "último editor" sale vacío, y eso
 * es justamente lo que distingue una edición del agente de una humana.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.string().uuid();

const isoDate = z.string().regex(ISO_DATE, 'Debe ser una fecha YYYY-MM-DD');

const currencyCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Debe ser un código de 3 letras, p. ej. USD');

const ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const lineItem = z.object({
  description: z.string().max(500),
  quantity: z.number().min(0).nullable().optional(),
  unitPrice: z.number().min(0).nullable().optional(),
  amount: z.number().min(0).nullable().optional(),
});

export function registerInvoiceScanTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'list_invoice_scans',
    'Document scans: todo lo pendiente de revisar (hasta 200, más reciente primero) más los últimos 50 ya marcados como ingresados en QuickBooks. Incluye facturas escaneadas y transacciones manuales.',
    {},
    async () => deps.invoiceScansService.list(),
  );

  registerMcpTool(
    server,
    'get_invoice_scan',
    'Un document scan por id, con los datos extraídos, las sugerencias de QuickBooks y una URL firmada para ver el documento (15 minutos).',
    { id: uuid.describe('ID del document scan') },
    async ({ id }: { id: string }) => deps.invoiceScansService.get(id),
  );

  registerMcpTool(
    server,
    'get_invoice_scan_download_url',
    'URL firmada que fuerza la descarga del documento original (15 minutos). Falla si el registro no tiene archivo, como una transacción manual sin adjuntar.',
    { id: uuid.describe('ID del document scan') },
    async ({ id }: { id: string }) => deps.invoiceScansService.getDownloadUrl(id),
  );

  registerMcpTool(
    server,
    'create_manual_transaction',
    'Registra un pago a mano, sin documento, y lo manda a la cola de revisión de QuickBooks. El archivo es opcional y se adjunta después con attach_invoice_scan_file.',
    {
      description: z.string().trim().min(1).max(255).describe('De qué fue el pago'),
      direction: z
        .enum(['payment_made', 'payment_received'])
        .describe('payment_made = salió dinero; payment_received = entró'),
      transactionDate: isoDate.describe('Fecha del pago (YYYY-MM-DD)'),
      amount: z.number().min(0.01).describe('Importe, mayor que cero'),
      currency: currencyCode
        .optional()
        .describe('Código de moneda; USD si se omite'),
      counterpartyName: z
        .string()
        .max(255)
        .optional()
        .describe('A quién se pagó o quién pagó'),
      projectNumber: z
        .string()
        .max(50)
        .nullable()
        .optional()
        .describe('Número de proyecto (lead number); debe existir o la llamada falla'),
    },
    async (args: {
      description: string;
      direction: 'payment_made' | 'payment_received';
      transactionDate: string;
      amount: number;
      currency?: string;
      counterpartyName?: string;
      projectNumber?: string | null;
    }) => deps.invoiceScansService.createManualTransaction(args),
  );

  registerMcpTool(
    server,
    'update_invoice_scan',
    'Corrige un document scan. Solo se tocan los campos presentes en la llamada; null borra el valor. `entered: true` lo pasa a la tabla de completados, false lo devuelve a pendientes. Falla si el documento se está escaneando en ese momento.',
    {
      id: uuid.describe('ID del document scan'),
      projectNumber: z.string().max(50).nullable().optional(),
      direction: z.enum(['outgoing', 'incoming', 'unknown']).optional(),
      classification: z
        .enum([
          'customer_service',
          'materials_expense',
          'subcontractor_expense',
          'other',
          'unknown',
        ])
        .optional(),
      counterpartyName: z.string().max(255).nullable().optional(),
      invoiceNumber: z.string().max(100).nullable().optional(),
      issueDate: isoDate.nullable().optional(),
      dueDate: isoDate.nullable().optional(),
      currency: currencyCode.nullable().optional(),
      subtotal: z.number().min(0).nullable().optional(),
      taxTotal: z.number().min(0).nullable().optional(),
      total: z.number().min(0).nullable().optional(),
      paymentStatus: z.enum(['paid', 'unpaid', 'unknown']).optional(),
      lineItems: z.array(lineItem).max(200).optional(),
      description: z
        .string()
        .max(255)
        .nullable()
        .optional()
        .describe('Solo transacciones manuales: de qué fue el pago'),
      transactionDirection: z
        .enum(['payment_made', 'payment_received'])
        .optional()
        .describe('Solo transacciones manuales: si salió o entró dinero'),
      comments: z.string().max(2000).nullable().optional(),
      entered: z
        .boolean()
        .optional()
        .describe('true = ya ingresado en QuickBooks; false = vuelve a pendientes'),
    },
    async ({ id, ...patch }: { id: string }) =>
      deps.invoiceScansService.update(id, patch),
  );

  registerMcpTool(
    server,
    'attach_invoice_scan_file',
    'Adjunta un documento a un registro que ya existe (típicamente una transacción manual guardada sin archivo). Devuelve una URL firmada de subida: el archivo hay que subirlo ahí con un PUT. No se escanea; los valores escritos a mano siguen valiendo.',
    {
      id: uuid.describe('ID del document scan'),
      fileName: z.string().max(255).describe('Nombre del archivo'),
      contentType: z
        .enum(ATTACHMENT_TYPES)
        .describe('Tipo MIME: JPG, PNG, WebP o PDF'),
      sizeBytes: z
        .number()
        .int()
        .min(1)
        .max(MAX_ATTACHMENT_BYTES)
        .describe('Tamaño en bytes, máximo 5 MB'),
    },
    async ({
      id,
      ...file
    }: {
      id: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
    }) => deps.invoiceScansService.attachFile(id, file),
  );

  registerMcpTool(
    server,
    'rescan_invoice_scan',
    'Vuelve a pasar el documento por la extracción automática y el cruce con QuickBooks. Sobrescribe los datos extraídos, así que pisa las correcciones hechas a mano.',
    { id: uuid.describe('ID del document scan') },
    async ({ id }: { id: string }) => deps.invoiceScansService.scan(id),
  );

  registerMcpTool(
    server,
    'delete_invoice_scan',
    'Borra un document scan y su archivo. NO SE PUEDE DESHACER: es un registro financiero y no queda copia. Exige confirm=true a propósito, para que no se dispare por una llamada mal interpretada. Falla si el documento se está escaneando.',
    {
      id: uuid.describe('ID del document scan'),
      confirm: z
        .literal(true)
        .describe('Debe ser exactamente true. Confirma un borrado irreversible.'),
    },
    async ({ id }: { id: string; confirm: true }) =>
      deps.invoiceScansService.remove(id),
  );
}
