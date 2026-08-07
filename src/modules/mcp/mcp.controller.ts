import { All, Controller, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './guards/mcp-auth.guard';

// MCP clients authenticate with MCP_TOKEN (McpAuthGuard), not the Google session cookie.
@Public()
@ApiExcludeController()
@Controller('mcp')
@UseGuards(McpAuthGuard)
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcpService: McpService) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = this.mcpService.createServer();

    res.on('close', () => {
      server.close().catch((err) => this.logger.error('Error closing MCP server', err));
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
