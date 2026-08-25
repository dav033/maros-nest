import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, IsNull, Repository } from 'typeorm';
import { TaskFile } from '../../entities/task-file.entity';
import { Task } from '../../entities/task.entity';
import { TaskWorkspace } from '../../entities/task-workspace.entity';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { S3Service } from '../s3/services/s3.service';
import type { CompleteManagedFileDto, CreateUploadIntentDto, ManagedFileOwnerKind, ManagedFileDto } from './dto/managed-file.dto';

const MAX_FILES_PER_OWNER = 50;
const ALLOWED_MIME = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/(plain|csv)|application\/(zip|json|msword|vnd\.openxmlformats-officedocument\..+)|application\/vnd\.(ms-excel|openxmlformats-officedocument\..+))$/i;

@Injectable()
export class ManagedFilesService {
  constructor(
    @InjectRepository(TaskFile) private readonly files: Repository<TaskFile>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(TaskWorkspace) private readonly workspaces: Repository<TaskWorkspace>,
    private readonly s3: S3Service,
  ) {}

  async createIntent(dto: CreateUploadIntentDto, actor: AuthenticatedUser): Promise<{ file: ManagedFileDto; uploadUrl: string; expiresInSeconds: number }> {
    await this.assertOwner(dto.ownerKind, dto.ownerId);
    this.assertFileInput(dto);
    const existing = await this.files.findOne({ where: dto.ownerKind === 'task'
      ? { taskId: dto.ownerId, clientUploadId: dto.clientUploadId, deletedAt: IsNull() }
      : { workspaceId: dto.ownerId, clientUploadId: dto.clientUploadId, deletedAt: IsNull() } });
    if (existing) return this.intentForExisting(existing);

    const count = await this.files.count({ where: dto.ownerKind === 'task'
      ? { taskId: dto.ownerId, deletedAt: IsNull() }
      : { workspaceId: dto.ownerId, deletedAt: IsNull() } });
    if (count >= MAX_FILES_PER_OWNER) throw new BadRequestException(`Maximum of ${MAX_FILES_PER_OWNER} files per owner exceeded`);

    const prefix = `managed/${dto.ownerKind}/${dto.ownerId}`;
    const presigned = await this.s3.getPresignedPutUrl({ fileName: dto.fileName, contentType: dto.mimeType, sizeBytes: dto.sizeBytes, prefix });
    const file = new TaskFile();
    file.taskId = dto.ownerKind === 'task' ? dto.ownerId : null;
    file.workspaceId = dto.ownerKind === 'workspace' ? dto.ownerId : null;
    file.s3Key = presigned.key;
    file.fileName = dto.fileName.trim();
    file.mimeType = dto.mimeType;
    file.sizeBytes = dto.sizeBytes;
    file.position = count * 1000 + 1000;
    file.status = 'pending';
    file.clientUploadId = dto.clientUploadId;
    file.uploadedById = actor.id;
    const saved = await this.files.save(file);
    return { file: this.toDto(saved, dto.ownerKind, dto.ownerId), uploadUrl: presigned.url, expiresInSeconds: presigned.expiresInSeconds };
  }

  async complete(id: number, dto: CompleteManagedFileDto): Promise<ManagedFileDto> {
    const file = await this.find(id);
    if (file.status === 'ready') return this.toDto(file, file.taskId != null ? 'task' : 'workspace', (file.taskId ?? file.workspaceId) as number);
    try {
      const metadata = await this.s3.getObjectMetadata(file.s3Key);
      if (metadata.contentLength !== file.sizeBytes || (metadata.contentType && metadata.contentType.toLowerCase() !== file.mimeType.toLowerCase())) {
        file.status = 'failed';
        await this.files.save(file);
        throw new BadRequestException('Uploaded file metadata does not match the upload intent');
      }
      file.checksum = dto.checksum ?? metadata.eTag ?? null;
      file.status = 'ready';
      return this.toDto(await this.files.save(file), file.taskId != null ? 'task' : 'workspace', (file.taskId ?? file.workspaceId) as number);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      file.status = 'failed';
      await this.files.save(file);
      throw error;
    }
  }

  async retry(id: number, actor: AuthenticatedUser): Promise<{ file: ManagedFileDto; uploadUrl: string; expiresInSeconds: number }> {
    const file = await this.find(id);
    if (file.status === 'ready') throw new BadRequestException('Ready files do not need retry');
    const ownerKind = file.taskId != null ? 'task' : 'workspace';
    const ownerId = (file.taskId ?? file.workspaceId) as number;
    await this.assertOwner(ownerKind, ownerId);
    const presigned = await this.s3.getPresignedPutUrlForManagedKey({ key: file.s3Key, contentType: file.mimeType, sizeBytes: Number(file.sizeBytes) });
    file.status = 'pending';
    file.uploadedById = actor.id;
    const saved = await this.files.save(file);
    return { file: this.toDto(saved, ownerKind, ownerId), uploadUrl: presigned.url, expiresInSeconds: presigned.expiresInSeconds };
  }

  async getDownloadUrl(id: number): Promise<{ url: string; expiresInSeconds: number }> {
    const file = await this.find(id);
    if (file.status !== 'ready' || file.deletedAt) throw new NotFoundException('File is not ready');
    const result = await this.s3.getPresignedGetUrl({ key: file.s3Key });
    return { url: result.url, expiresInSeconds: result.expiresInSeconds };
  }

  async remove(id: number): Promise<void> {
    const file = await this.find(id);
    file.deletedAt = new Date();
    await this.files.save(file);
    try { await this.s3.deleteObject(file.s3Key); } catch { /* DB tombstone remains authoritative. */ }
  }

  async cleanupStalePending(): Promise<number> {
    const stale = await this.files.find({ where: { status: 'pending', deletedAt: IsNull(), updatedAt: LessThan(new Date(Date.now() - 24 * 60 * 60 * 1000)) }, take: 100 });
    for (const file of stale) { file.status = 'failed'; await this.files.save(file); }
    return stale.length;
  }

  private async intentForExisting(file: TaskFile) {
    const ownerKind = file.taskId != null ? 'task' : 'workspace';
    const ownerId = (file.taskId ?? file.workspaceId) as number;
    const presigned = await this.s3.getPresignedPutUrlForManagedKey({ key: file.s3Key, contentType: file.mimeType, sizeBytes: Number(file.sizeBytes) });
    return { file: this.toDto(file, ownerKind, ownerId), uploadUrl: presigned.url, expiresInSeconds: presigned.expiresInSeconds };
  }

  private async find(id: number): Promise<TaskFile> {
    const file = await this.files.findOne({ where: { id, deletedAt: IsNull() } });
    if (!file) throw new NotFoundException(`Managed file ${id} not found`);
    return file;
  }

  private async assertOwner(kind: ManagedFileOwnerKind, id: number): Promise<void> {
    const exists = kind === 'task'
      ? await this.tasks.exists({ where: { id, deletedAt: IsNull() } })
      : await this.workspaces.exists({ where: { id, archivedAt: IsNull() } });
    if (!exists) throw new NotFoundException(`${kind} ${id} not found or unavailable`);
  }

  private assertFileInput(dto: CreateUploadIntentDto): void {
    const name = dto.fileName.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
    if (!name || name === '.' || name === '..' || name.includes('..')) throw new BadRequestException('Invalid file name');
    if (!ALLOWED_MIME.test(dto.mimeType)) throw new BadRequestException('File MIME type is not allowed');
    if (!Number.isSafeInteger(dto.sizeBytes) || dto.sizeBytes < 0) throw new BadRequestException('Invalid file size');
  }

  private toDto(file: TaskFile, ownerKind: ManagedFileOwnerKind, ownerId: number): ManagedFileDto {
    return { id: file.id, ownerKind, ownerId, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes), position: Number(file.position), status: file.status, createdAt: file.createdAt.toISOString(), updatedAt: file.updatedAt.toISOString() };
  }
}
