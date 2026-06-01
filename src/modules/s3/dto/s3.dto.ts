export interface GetPresignedPutUrlInput {
  fileName: string;
  contentType: string;
  sizeBytes?: number;
  prefix?: string;
  expiresInSeconds?: number;
}

export interface PresignedPutUrlResult {
  bucket: string;
  key: string;
  url: string;
  expiresInSeconds: number;
  maxUploadBytes: number;
  contentType: string;
}

export interface GetPresignedGetUrlInput {
  key: string;
  expiresInSeconds?: number;
}

export interface PresignedGetUrlResult {
  bucket: string;
  key: string;
  url: string;
  expiresInSeconds: number;
}

export interface ListS3ObjectsInput {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface S3ObjectItem {
  key: string;
  size: number;
  lastModified: string | null;
  eTag: string | null;
  storageClass: string | null;
}

export interface ListS3ObjectsResult {
  bucket: string;
  prefix: string;
  maxKeys: number;
  isTruncated: boolean;
  nextContinuationToken: string | null;
  items: S3ObjectItem[];
}

export interface S3ObjectMetadataResult {
  bucket: string;
  key: string;
  contentLength: number | null;
  contentType: string | null;
  eTag: string | null;
  lastModified: string | null;
  metadata: Record<string, string>;
}

export interface DeleteS3ObjectResult {
  deleted: boolean;
  bucket: string;
  key: string;
}

export interface UploadFileFromServerInput {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  prefix?: string;
}

export interface UploadFileFromServerResult {
  uploaded: boolean;
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface S3UploadRules {
  basePrefix: string;
  maxUploadBytes: number;
}
