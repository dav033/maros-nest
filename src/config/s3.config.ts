import { registerAs } from '@nestjs/config';

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  basePrefix: string;
  presignedUrlExpiresSeconds: number;
  maxUploadBytes: number;
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    return 'mcp/attachments/';
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export default registerAs(
  's3',
  (): S3Config => {
    const maxUploadMb = toPositiveNumber(process.env.S3_MAX_UPLOAD_MB, 5);
    const maxUploadBytes = Math.floor(maxUploadMb * 1024 * 1024);

    return {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      bucketName: process.env.S3_BUCKET_NAME || '',
      region: process.env.S3_REGION || '',
      endpoint: process.env.S3_ENDPOINT || '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
      basePrefix: normalizePrefix(process.env.S3_BASE_PREFIX || 'mcp/attachments/'),
      presignedUrlExpiresSeconds: Math.floor(
        toPositiveNumber(process.env.S3_PRESIGNED_URL_EXPIRES_SECONDS, 900),
      ),
      maxUploadBytes,
    };
  },
);
