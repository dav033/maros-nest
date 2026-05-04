import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpToolDeps } from './shared';
import { registerQboJobCostingMainTools } from './qbo-job-costing-main';

export function registerQboJobCostingTools(server: McpServer, deps: McpToolDeps) {
  registerQboJobCostingMainTools(server, deps);
}
