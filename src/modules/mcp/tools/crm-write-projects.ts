import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateProjectDto } from '../../projects/project-management/dto/create-project.dto';
import { UpdateProjectDto } from '../../projects/project-management/dto/update-project.dto';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { InvoiceStatus } from '../../../common/enums/invoice-status.enum';
import { McpToolDeps, jsonContent } from './shared';
import { deletedMessage } from './crm-write-shared';
import { enumFromTsEnum } from './zod-utils';

export function registerProjectWriteTools(server: McpServer, deps: McpToolDeps) {
  server.tool(
    'delete_project',
    'Delete a project by its ID. The associated lead is preserved',
    { projectId: z.number().describe('The project ID to delete') },
    async ({ projectId }) => {
      await deps.projectsService.delete(projectId);
      return deletedMessage('Project', projectId);
    },
  );

  server.tool(
    'create_project',
    'Create a new project for an existing lead',
    {
      leadId: z.number().describe('Lead ID to associate the project with'),
      invoiceAmount: z.number().optional().describe('Invoice amount'),
      payments: z.array(z.number()).optional().describe('Payments made (array of amounts)'),
      projectProgressStatus: enumFromTsEnum(ProjectProgressStatus)
        .optional()
        .describe('Project progress status'),
      invoiceStatus: enumFromTsEnum(InvoiceStatus)
        .optional()
        .describe('Invoice status'),
      quickbooks: z.boolean().optional().describe('Is it registered in QuickBooks?'),
      overview: z.string().optional().describe('Project overview/description'),
      notes: z.array(z.string()).optional().describe('Project notes'),
    },
    async (fields) => {
      const data = await deps.projectsService.create(fields as CreateProjectDto);
      return jsonContent(data);
    },
  );

  server.tool(
    'update_project',
    'Update an existing project by its ID. Only provided fields are updated',
    {
      projectId: z.number().describe('The project ID to update'),
      invoiceAmount: z.number().optional().describe('Invoice amount'),
      payments: z
        .array(z.number())
        .optional()
        .describe('Payments made (replaces all existing payments)'),
      projectProgressStatus: enumFromTsEnum(ProjectProgressStatus)
        .optional()
        .describe('Project progress status'),
      invoiceStatus: enumFromTsEnum(InvoiceStatus)
        .optional()
        .describe('Invoice status'),
      quickbooks: z.boolean().optional().describe('Is it registered in QuickBooks?'),
      overview: z.string().optional().describe('Project overview/description'),
      notes: z
        .array(z.string())
        .optional()
        .describe('Project notes (replaces all existing notes)'),
    },
    async ({ projectId, ...fields }) => {
      const data = await deps.projectsService.update(
        projectId,
        fields as UpdateProjectDto,
      );
      return jsonContent(data);
    },
  );
}
