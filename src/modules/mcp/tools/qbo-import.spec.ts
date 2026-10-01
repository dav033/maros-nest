import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerQboImportTools } from './qbo-import';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MCP_EMAIL = 'mcp-agent@maros.invalid';

function registerTools() {
  const tools = new Map<string, Registered>();
  const server = {
    tool: (
      name: string,
      description: string,
      schema: ZodRawShape,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      tools.set(name, { description, schema, handler });
    },
  };

  const qboProjectImport = {
    listJobs: jest.fn().mockResolvedValue([]),
    importJob: jest.fn().mockResolvedValue({ projectId: 1 }),
    importBatch: jest.fn().mockResolvedValue({ applied: 1, failed: 0 }),
    linkProject: jest.fn().mockResolvedValue({ projectId: 1, qboCustomerId: '55' }),
    unlinkProject: jest.fn().mockResolvedValue({ projectId: 1, unlinked: true }),
  };
  const projectQboReport = { getProjectReport: jest.fn().mockResolvedValue({ rows: [] }) };
  const qboConnectionStatus = { getStatus: jest.fn().mockResolvedValue({ connected: true }) };
  const mcpActor = {
    authenticatedUser: jest.fn().mockResolvedValue({ id: 17, email: MCP_EMAIL }),
  };

  registerQboImportTools(server as unknown as McpServer, {
    qboProjectImport,
    projectQboReport,
    qboConnectionStatus,
    mcpActor,
  } as unknown as McpToolDeps);

  return { tools, qboProjectImport, projectQboReport, qboConnectionStatus };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

describe('registerQboImportTools', () => {
  it('registers the connection, import, link and report tools', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'get_project_qbo_report',
      'get_quickbooks_connection_status',
      'import_quickbooks_job',
      'import_quickbooks_jobs_batch',
      'link_project_to_quickbooks',
      'list_quickbooks_jobs',
      'unlink_project_from_quickbooks',
    ]);
  });

  // El historial no debe decir que una persona apreto un boton que no apreto.
  it.each([
    ['link_project_to_quickbooks', { projectId: 1, qboCustomerId: '55' }, 'linkProject'],
    ['unlink_project_from_quickbooks', { projectId: 1 }, 'unlinkProject'],
  ])('records %s as done by the MCP system user', async (tool, args, method) => {
    const { tools, qboProjectImport } = registerTools();

    await tools.get(tool)!.handler(args);

    const call = (qboProjectImport as Record<string, jest.Mock>)[method].mock.calls[0];
    expect(call[call.length - 1]).toBe(MCP_EMAIL);
  });

  it('passes the report query separately from the project id', async () => {
    const { tools, projectQboReport } = registerTools();

    await tools.get('get_project_qbo_report')!.handler({
      projectId: 4,
      report: 'BalanceSheet',
      accountingMethod: 'Cash',
    });

    expect(projectQboReport.getProjectReport).toHaveBeenCalledWith(4, {
      report: 'BalanceSheet',
      accountingMethod: 'Cash',
    });
  });

  describe('validation', () => {
    it.each([
      ['a report that does not exist', 'get_project_qbo_report', {
        projectId: 1,
        report: 'TrialBalance',
      }],
      ['an accounting method that does not exist', 'get_project_qbo_report', {
        projectId: 1,
        accountingMethod: 'Hybrid',
      }],
      ['a date that is not YYYY-MM-DD', 'get_project_qbo_report', {
        projectId: 1,
        startDate: '01/2026',
      }],
      ['an empty QuickBooks job id', 'link_project_to_quickbooks', {
        projectId: 1,
        qboCustomerId: '   ',
      }],
      ['a job id over 50 characters', 'link_project_to_quickbooks', {
        projectId: 1,
        qboCustomerId: 'x'.repeat(51),
      }],
      ['an import with no project number', 'import_quickbooks_job', {
        qboCustomerId: '55',
      }],
      ['a batch with no decisions', 'import_quickbooks_jobs_batch', { decisions: [] }],
    ])('rejects %s', (_label, tool, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get(tool)!.schema, args).success).toBe(false);
    });

    it('accepts a batch of well-formed decisions', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('import_quickbooks_jobs_batch')!.schema, {
          decisions: [
            { qboCustomerId: '55', projectNumber: '101-0126' },
            { qboCustomerId: '56', projectNumber: '102-0126', projectId: 9 },
          ],
        }).success,
      ).toBe(true);
    });
  });

  it('reads the connection status and the job list', async () => {
    const { tools, qboConnectionStatus, qboProjectImport } = registerTools();

    await tools.get('get_quickbooks_connection_status')!.handler({});
    await tools.get('list_quickbooks_jobs')!.handler({});

    expect(qboConnectionStatus.getStatus).toHaveBeenCalled();
    expect(qboProjectImport.listJobs).toHaveBeenCalled();
  });
});
