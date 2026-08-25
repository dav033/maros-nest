import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const MANAGED_FILE_OWNER_KINDS = ['task', 'workspace'] as const;
export type ManagedFileOwnerKind = (typeof MANAGED_FILE_OWNER_KINDS)[number];

export class CreateUploadIntentDto {
  @IsIn(MANAGED_FILE_OWNER_KINDS)
  ownerKind: ManagedFileOwnerKind;

  @IsInt()
  ownerId: number;

  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @MaxLength(160)
  mimeType: string;

  @IsInt()
  @Min(0)
  sizeBytes: number;

  @IsString()
  @MaxLength(160)
  clientUploadId: string;
}

export class CompleteManagedFileDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  checksum?: string;
}

export interface ManagedFileDto {
  id: number;
  ownerKind: ManagedFileOwnerKind;
  ownerId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface UploadIntentDto {
  file: ManagedFileDto;
  uploadUrl: string;
  expiresInSeconds: number;
}
