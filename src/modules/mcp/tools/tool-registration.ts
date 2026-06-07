import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShape } from 'zod';
import { QboReauthorizationRequiredException } from '../../quickbooks/exceptions/qbo-reauthorization-required.exception';
import { jsonContent } from './shared';

const logger = new Logger('McpTool');

type ToolErrorPayload = {
  status: 'error';
  code: 'qbo_connection_required' | 'tool_execution_failed';
  tool: string;
  message: string;
  suggestions?: string[];
};

function isQboConnectionError(error: unknown): boolean {
  if (error instanceof QboReauthorizationRequiredException) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('requires manual reauthorization') ||
    message.includes('QBO_REAUTHORIZATION_REQUIRED') ||
    message.includes('QuickBooks connection')
  );
}

function buildErrorPayload(tool: string, error: unknown): ToolErrorPayload {
  if (isQboConnectionError(error)) {
    return {
      status: 'error',
      code: 'qbo_connection_required',
      tool,
      message: 'QuickBooks no está conectado o necesita autorización.',
      suggestions: [
        'Conecta QuickBooks nuevamente antes de consultar información financiera.',
      ],
    };
  }
  return {
    status: 'error',
    code: 'tool_execution_failed',
    tool,
    message: error instanceof Error ? error.message : String(error),
  };
}

type McpToolResult = ReturnType<typeof jsonContent>;

function isMcpToolResult(value: unknown): value is McpToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

export function registerMcpTool<TArgs = Record<string, unknown>>(
  server: McpServer,
  name: string,
  description: string,
  schema: ZodRawShape,
  handler: (args: TArgs) => Promise<unknown>,
): void {
  server.tool(name, description, schema, async (args): Promise<McpToolResult> => {
    try {
      const data = await handler(args as TArgs);
      if (isMcpToolResult(data)) return data;
      return jsonContent(data);
    } catch (error) {
      const payload = buildErrorPayload(name, error);
      logger.error(
        `[mcp.tool] ${name} failed: ${payload.code} - ${payload.message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { ...jsonContent(payload), isError: true } as McpToolResult;
    }
  });
}
