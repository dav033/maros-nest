import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

export function registerS3Tools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    's3_get_presigned_put_url',
    'Generate a presigned URL for uploading a file to S3 under mcp/attachments/. Max upload is 5 MB by policy.',
    {
      fileName: z.string().describe('Original file name, e.g. invoice.pdf'),
      contentType: z.string().describe('MIME type, e.g. application/pdf or image/png'),
      sizeBytes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional file size in bytes (must be <= 5 MB)'),
      prefix: z
        .string()
        .optional()
        .describe('Optional subfolder under mcp/attachments/'),
      expiresInSeconds: z
        .number()
        .int()
        .positive()
        .max(3600)
        .optional()
        .describe('Optional URL expiration in seconds (default 900, max 3600)'),
    },
    async (input: Parameters<typeof deps.s3Service.getPresignedPutUrl>[0]) =>
      deps.s3Service.getPresignedPutUrl(input),
  );

  registerMcpTool(
    server,
    's3_get_presigned_get_url',
    'Generate a presigned URL for downloading a file from S3.',
    {
      key: z
        .string()
        .describe('S3 object key inside mcp/attachments/ (absolute or relative key)'),
      expiresInSeconds: z
        .number()
        .int()
        .positive()
        .max(3600)
        .optional()
        .describe('Optional URL expiration in seconds (default 900, max 3600)'),
    },
    async (input: Parameters<typeof deps.s3Service.getPresignedGetUrl>[0]) =>
      deps.s3Service.getPresignedGetUrl(input),
  );

  registerMcpTool(
    server,
    's3_list_objects',
    'List objects in S3 under mcp/attachments/ with pagination support.',
    {
      prefix: z.string().optional().describe('Optional subfolder/prefix filter'),
      maxKeys: z
        .number()
        .int()
        .positive()
        .max(1000)
        .optional()
        .describe('Max items per page (default 50, max 1000)'),
      continuationToken: z
        .string()
        .optional()
        .describe('Token from previous page for pagination'),
    },
    async (input: Parameters<typeof deps.s3Service.listObjects>[0]) =>
      deps.s3Service.listObjects(input),
  );

  registerMcpTool(
    server,
    's3_get_object_metadata',
    'Read object metadata from S3 (size, MIME, etag, timestamps).',
    {
      key: z
        .string()
        .describe('S3 object key inside mcp/attachments/ (absolute or relative key)'),
    },
    async ({ key }: { key: string }) => deps.s3Service.getObjectMetadata(key),
  );

  registerMcpTool(
    server,
    's3_delete_object',
    'Delete an object from S3 under mcp/attachments/.',
    {
      key: z
        .string()
        .describe('S3 object key inside mcp/attachments/ (absolute or relative key)'),
    },
    async ({ key }: { key: string }) => deps.s3Service.deleteObject(key),
  );
}
