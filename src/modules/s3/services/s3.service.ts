import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ExternalServiceException, ValidationException } from '../../../common/exceptions';
import s3Config from '../../../config/s3.config';
import {
  DeleteS3ObjectResult,
  GetPresignedGetUrlInput,
  GetPresignedPutUrlInput,
  ListS3ObjectsInput,
  ListS3ObjectsResult,
  PresignedGetUrlResult,
  PresignedPutUrlResult,
  S3UploadRules,
  S3ObjectMetadataResult,
  UploadFileFromServerInput,
  UploadFileFromServerResult,
} from '../dto/s3.dto';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;

  constructor(
    @Inject(s3Config.KEY)
    private readonly config: ConfigType<typeof s3Config>,
  ) {
    this.s3Client = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      endpoint: this.config.endpoint || undefined,
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  async getPresignedPutUrl(
    input: GetPresignedPutUrlInput,
  ): Promise<PresignedPutUrlResult> {
    this.ensureConfigured();
    this.ensureContentType(input.contentType);

    if (typeof input.sizeBytes === 'number' && input.sizeBytes > this.config.maxUploadBytes) {
      throw new ValidationException(
        `sizeBytes exceeds max allowed (${this.config.maxUploadBytes} bytes)`,
        'sizeBytes',
      );
    }

    const key = this.buildObjectKey(input.fileName, input.prefix);
    const expiresInSeconds = this.resolveExpiration(input.expiresInSeconds);

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ContentType: input.contentType,
    });

    const url = await this.exec<string>(
      () => getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds }),
      `PRESIGN PUT ${key}`,
    );

    return {
      bucket: this.config.bucketName,
      key,
      url,
      expiresInSeconds,
      maxUploadBytes: this.config.maxUploadBytes,
      contentType: input.contentType,
    };
  }

  async uploadFileFromServer(
    input: UploadFileFromServerInput,
  ): Promise<UploadFileFromServerResult> {
    this.ensureConfigured();
    this.ensureContentType(input.contentType);

    if (!input.buffer || input.buffer.length === 0) {
      throw new ValidationException('File content is empty', 'file');
    }

    if (input.sizeBytes > this.config.maxUploadBytes) {
      throw new ValidationException(
        `File exceeds max allowed (${this.config.maxUploadBytes} bytes)`,
        'file',
      );
    }

    const key = this.buildObjectKey(input.fileName, input.prefix);

    await this.exec(
      () =>
        this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.config.bucketName,
            Key: key,
            Body: input.buffer,
            ContentType: input.contentType,
            ContentLength: input.sizeBytes,
          }),
        ),
      `PUT ${key}`,
    );

    return {
      uploaded: true,
      bucket: this.config.bucketName,
      key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    };
  }

  getUploadRules(): S3UploadRules {
    return {
      basePrefix: this.config.basePrefix,
      maxUploadBytes: this.config.maxUploadBytes,
    };
  }

  async getPresignedGetUrl(
    input: GetPresignedGetUrlInput,
  ): Promise<PresignedGetUrlResult> {
    this.ensureConfigured();

    const key = this.normalizeExistingKey(input.key);
    const expiresInSeconds = this.resolveExpiration(input.expiresInSeconds);
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });

    const url = await this.exec<string>(
      () => getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds }),
      `PRESIGN GET ${key}`,
    );

    return {
      bucket: this.config.bucketName,
      key,
      url,
      expiresInSeconds,
    };
  }

  async listObjects(input: ListS3ObjectsInput = {}): Promise<ListS3ObjectsResult> {
    this.ensureConfigured();

    const prefix = this.resolvePrefix(input.prefix);
    const maxKeys = this.resolveMaxKeys(input.maxKeys);
    const response = await this.exec<any>(
      () =>
        this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: this.config.bucketName,
            Prefix: prefix,
            MaxKeys: maxKeys,
            ContinuationToken: input.continuationToken,
          }),
        ),
      `LIST ${prefix}`,
    );

    return {
      bucket: this.config.bucketName,
      prefix,
      maxKeys,
      isTruncated: Boolean(response.IsTruncated),
      nextContinuationToken: response.NextContinuationToken || null,
      items: (response.Contents || []).map((item) => ({
        key: item.Key || '',
        size: item.Size || 0,
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
        eTag: item.ETag || null,
        storageClass: item.StorageClass || null,
      })),
    };
  }

  async getObjectMetadata(key: string): Promise<S3ObjectMetadataResult> {
    this.ensureConfigured();

    const resolvedKey = this.normalizeExistingKey(key);
    const response = await this.exec<any>(
      () =>
        this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.config.bucketName,
            Key: resolvedKey,
          }),
        ),
      `HEAD ${resolvedKey}`,
    );

    return {
      bucket: this.config.bucketName,
      key: resolvedKey,
      contentLength: response.ContentLength ?? null,
      contentType: response.ContentType ?? null,
      eTag: response.ETag ?? null,
      lastModified: response.LastModified ? response.LastModified.toISOString() : null,
      metadata: response.Metadata || {},
    };
  }

  async getObjectBuffer(
    key: string,
  ): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
    this.ensureConfigured();
    const resolvedKey = this.normalizeExistingKey(key);
    const response = await this.exec<any>(
      () =>
        this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.config.bucketName,
            Key: resolvedKey,
          }),
        ),
      `GET ${resolvedKey}`,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: response.ContentType ?? null,
      fileName: resolvedKey.split('/').pop() || 'attachment',
    };
  }

  async deleteObject(key: string): Promise<DeleteS3ObjectResult> {
    this.ensureConfigured();

    const resolvedKey = this.normalizeExistingKey(key);
    await this.exec(
      () =>
        this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.config.bucketName,
            Key: resolvedKey,
          }),
        ),
      `DELETE ${resolvedKey}`,
    );

    return {
      deleted: true,
      bucket: this.config.bucketName,
      key: resolvedKey,
    };
  }

  private ensureConfigured(): void {
    const missing = [
      ['S3_ACCESS_KEY_ID', this.config.accessKeyId],
      ['S3_SECRET_ACCESS_KEY', this.config.secretAccessKey],
      ['S3_BUCKET_NAME', this.config.bucketName],
      ['S3_REGION', this.config.region],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new ExternalServiceException(
        `S3 is not configured. Missing: ${missing.join(', ')}`,
        'S3',
      );
    }
  }

  private ensureContentType(contentType: string): void {
    if (!contentType || contentType.trim().length === 0) {
      throw new ValidationException('contentType is required', 'contentType');
    }
  }

  private resolveExpiration(expiresInSeconds?: number): number {
    const raw = expiresInSeconds ?? this.config.presignedUrlExpiresSeconds;
    if (!Number.isFinite(raw) || raw <= 0) {
      return this.config.presignedUrlExpiresSeconds;
    }

    return Math.max(60, Math.min(3600, Math.floor(raw)));
  }

  private resolveMaxKeys(maxKeys?: number): number {
    if (!Number.isFinite(maxKeys as number) || (maxKeys as number) <= 0) {
      return 50;
    }

    return Math.max(1, Math.min(1000, Math.floor(maxKeys as number)));
  }

  private resolvePrefix(prefix?: string): string {
    if (!prefix || prefix.trim().length === 0) {
      return this.config.basePrefix;
    }

    const normalized = this.normalizePath(prefix);
    this.assertNoTraversal(normalized);

    if (normalized.startsWith(this.config.basePrefix)) {
      return normalized.endsWith('/') ? normalized : `${normalized}/`;
    }

    return `${this.config.basePrefix}${normalized.endsWith('/') ? normalized : `${normalized}/`}`;
  }

  private normalizeExistingKey(key: string): string {
    let normalized = this.normalizePath(key);
    this.assertNoTraversal(normalized);

    if (!normalized) {
      throw new ValidationException('key is required', 'key');
    }

    if (!normalized.startsWith(this.config.basePrefix)) {
      normalized = `${this.config.basePrefix}${normalized}`;
    }

    return normalized;
  }

  private buildObjectKey(fileName: string, prefix?: string): string {
    const safeName = this.sanitizeFileName(fileName);
    const subPrefix = this.normalizeSubPrefix(prefix);
    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');

    return `${this.config.basePrefix}${subPrefix}${timestamp}-${randomUUID()}-${safeName}`;
  }

  private normalizeSubPrefix(prefix?: string): string {
    if (!prefix || prefix.trim().length === 0) {
      return '';
    }

    let normalized = this.normalizePath(prefix);
    this.assertNoTraversal(normalized);

    if (normalized.startsWith(this.config.basePrefix)) {
      normalized = normalized.slice(this.config.basePrefix.length);
    }

    if (!normalized) {
      return '';
    }

    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }

  private sanitizeFileName(fileName: string): string {
    const pathNormalized = fileName.replace(/\\/g, '/');
    const tail = pathNormalized.split('/').pop() || '';
    const trimmed = tail.trim();

    if (!trimmed) {
      throw new ValidationException('fileName is required', 'fileName');
    }

    const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
    const safe = sanitized.slice(-120);

    if (!safe || safe === '.' || safe === '..') {
      throw new ValidationException('fileName is invalid', 'fileName');
    }

    return safe;
  }

  private normalizePath(value: string): string {
    return value
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .trim();
  }

  private assertNoTraversal(path: string): void {
    if (path.includes('..')) {
      throw new ValidationException('Path traversal is not allowed', 'key');
    }
  }

  private async exec<T>(call: () => Promise<T>, label: string): Promise<T> {
    try {
      return await call();
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode ?? err?.response?.status;
      const message = err?.message ?? 'unknown';
      const originalError = err instanceof Error ? err : undefined;

      this.logger.error(`S3 ${label} failed [${status}]: ${message}`);

      throw new ExternalServiceException(
        `S3 ${label} failed: ${message}`,
        'S3',
        originalError,
      );
    }
  }
}
