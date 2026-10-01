import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  QboAccountingMethod,
  QboReportName,
} from '../../projects/project-management/dto/qbo-report-query.dto';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { enumFromTsEnum } from './zod-utils';

/**
 * Lo que se construyó en QuickBooks y todavía no tenía tools: el estado de la
 * conexión, la importación de jobs como proyectos, vincular y desvincular a mano,
 * y el reporte crudo por proyecto.
 *
 * Vincular y desvincular registran quién lo hizo. Se pasa el correo del usuario
 * de sistema del MCP, no el de una persona: el token del MCP no identifica a
 * nadie y el historial no debe decir que alguien apretó un botón que no apretó.
 */

const projectId = z.number().int().positive();
const qboCustomerId = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .describe('Id del job/customer en QuickBooks');

const importDecision = {
  qboCustomerId,
  projectNumber: z
    .string()
    .trim()
    .min(1)
    .describe('Número de proyecto a usar en el CRM'),
  name: z.string().optional(),
  location: z.string().optional(),
  leadId: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Adjuntar al lead existente en vez de crear uno'),
  projectId: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Vincular al proyecto existente en vez de crear uno'),
};

export function registerQboImportTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'get_quickbooks_connection_status',
    'Si QuickBooks está conectado, a qué realm y si el token necesita reautorización. Conviene consultarlo antes de dar por buena una cifra financiera vacía.',
    {},
    async () => deps.qboConnectionStatus.getStatus(),
  );

  registerMcpTool(
    server,
    'list_quickbooks_jobs',
    'Los jobs de QuickBooks listos para importar, cada uno con el proyecto o lead del CRM que le corresponde si ya existe y las colisiones detectadas. Es el paso previo a importar: dice qué decisión hace falta para cada uno.',
    {},
    async () => deps.qboProjectImport.listJobs(),
  );

  registerMcpTool(
    server,
    'import_quickbooks_job',
    'Importa un job de QuickBooks como proyecto del CRM, o lo adjunta a un lead o proyecto que ya existe si se pasa leadId o projectId.',
    importDecision,
    async (dto: Record<string, unknown>) =>
      deps.qboProjectImport.importJob(dto as never),
  );

  registerMcpTool(
    server,
    'import_quickbooks_jobs_batch',
    'Importa varios jobs de una vez. Cada decisión se aplica bajo su propio savepoint, así que una que falle no tumba a las demás; la respuesta dice qué pasó con cada una.',
    {
      decisions: z
        .array(z.object(importDecision))
        .min(1)
        .describe('Una decisión por job, como las de import_quickbooks_job'),
    },
    async (dto: { decisions: unknown[] }) =>
      deps.qboProjectImport.importBatch(dto as never),
  );

  registerMcpTool(
    server,
    'link_project_to_quickbooks',
    'Vincula a mano un proyecto del CRM con un job de QuickBooks. A partir de ahí el proyecto puede ver sus reportes y sus cifras financieras.',
    { projectId, qboCustomerId },
    async ({
      projectId: id,
      qboCustomerId: customerId,
    }: {
      projectId: number;
      qboCustomerId: string;
    }) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.qboProjectImport.linkProject(id, customerId, actor.email);
    },
  );

  registerMcpTool(
    server,
    'unlink_project_from_quickbooks',
    'Rompe el vínculo entre un proyecto y su job de QuickBooks. El proyecto deja de tener reportes financieros hasta que se vuelva a vincular.',
    { projectId },
    async ({ projectId: id }: { projectId: number }) => {
      const actor = await deps.mcpActor.authenticatedUser();
      return deps.qboProjectImport.unlinkProject(id, actor.email);
    },
  );

  registerMcpTool(
    server,
    'get_project_qbo_report',
    'Un reporte de QuickBooks filtrado por el job del proyecto, tal como lo devuelve Intuit. Falla con 409 si el proyecto no está vinculado. Cash y Accrual dan cifras distintas, y el método por defecto es Accrual.',
    {
      projectId,
      report: enumFromTsEnum(QboReportName)
        .optional()
        .describe('ProfitAndLossDetail si se omite'),
      accountingMethod: enumFromTsEnum(QboAccountingMethod)
        .optional()
        .describe('Accrual si se omite'),
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    async ({ projectId: id, ...query }: { projectId: number }) =>
      deps.projectQboReport.getProjectReport(id, query as never),
  );
}
