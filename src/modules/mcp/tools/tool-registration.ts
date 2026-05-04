import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShape } from 'zod';
import { jsonContent } from './shared';

export function registerJsonTool<TArgs extends Record<string, unknown>>(
  server: McpServer,
  name: string,
  description: string,
  schema: ZodRawShape,
  handler: (args: TArgs) => Promise<unknown>,
): void {
  server.tool(name, description, schema, async (args) => {
    const data = await handler(args as TArgs);
    return jsonContent(data);
  });
}
