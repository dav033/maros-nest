import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateProjectDto } from '../../projects/project-management/dto/create-project.dto';
import { UpdateProjectDto } from '../../projects/project-management/dto/update-project.dto';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { deletedMessage } from './crm-write-shared';
import { enumFromTsEnum } from './zod-utils';

const projectWritableShape = {
  projectProgressStatus: enumFromTsEnum(ProjectProgressStatus)
    .optional()
    .describe('Project progress status'),
  overview: z.string().optional().describe('Project overview/description'),
  notes: z.array(z.string()).optional().describe('Project notes'),
  attachments: z
    .array(z.string())
    .optional()
    .describe('Attachment S3 keys for the project'),
};

export function registerProjectWriteTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'delete_project',
    'Delete a project by its ID. The associated lead is preserved',
    { projectId: z.number().describe('The project ID to delete') },
    async ({ projectId }: { projectId: number }) => {
      await deps.projectsService.delete(projectId);
      return deletedMessage('Project', projectId);
    },
  );

  registerMcpTool(
    server,
    'create_project',
    'Create a new project for an existing lead',
    {
      leadId: z.number().describe('Lead ID to associate the project with'),
      ...projectWritableShape,
    },
    async (fields: Record<string, unknown>) =>
      deps.projectsService.create(fields as unknown as CreateProjectDto),
  );

  registerMcpTool(
    server,
    'update_project',
    'Update an existing project by its ID. Only provided fields are updated',
    {
      projectId: z.number().describe('The project ID to update'),
      ...projectWritableShape,
      notes: z
        .array(z.string())
        .optional()
        .describe('Project notes (replaces all existing notes)'),
      leadName: z
        .string()
        .optional()
        .describe("Optionally update the linked lead's name (max 100 chars)"),
      leadNumber: z
        .string()
        .optional()
        .describe("Optionally update the linked lead's lead number (max 50 chars)"),
    },
    async ({ projectId, ...fields }: { projectId: number } & Record<string, unknown>) =>
      deps.projectsService.update(projectId, fields as UpdateProjectDto),
  );
}
