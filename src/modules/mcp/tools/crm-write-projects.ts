import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateProjectDto } from '../../projects/project-management/dto/create-project.dto';
import { UpdateProjectDto } from '../../projects/project-management/dto/update-project.dto';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';
import { deletedMessage } from './crm-write-shared';
import { enumFromTsEnum } from './zod-utils';

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
      projectProgressStatus: enumFromTsEnum(ProjectProgressStatus)
        .optional()
        .describe('Project progress status'),
      overview: z.string().optional().describe('Project overview/description'),
      notes: z.array(z.string()).optional().describe('Project notes'),
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
      projectProgressStatus: enumFromTsEnum(ProjectProgressStatus)
        .optional()
        .describe('Project progress status'),
      overview: z.string().optional().describe('Project overview/description'),
      notes: z
        .array(z.string())
        .optional()
        .describe('Project notes (replaces all existing notes)'),
    },
    async ({ projectId, ...fields }: { projectId: number } & Record<string, unknown>) =>
      deps.projectsService.update(projectId, fields as UpdateProjectDto),
  );
}
