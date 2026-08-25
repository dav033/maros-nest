import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Task } from './task.entity';
import { TaskWorkspace } from './task-workspace.entity';

export const TASK_FILE_STATUSES = ['pending', 'ready', 'failed'] as const;
export type TaskFileStatus = (typeof TASK_FILE_STATUSES)[number];

@Entity('task_files')
@Index('idx_task_files_task_position', ['taskId', 'position', 'id'])
@Index('idx_task_files_workspace_position', ['workspaceId', 'position', 'id'])
export class TaskFile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'task_id', type: 'int', nullable: true })
  taskId?: number | null;

  @Column({ name: 'workspace_id', type: 'int', nullable: true })
  workspaceId?: number | null;

  @Column({ name: 's3_key', type: 'text', unique: true })
  s3Key: string;

  @Column({ name: 'file_name', length: 255 })
  fileName: string;

  @Column({ name: 'mime_type', length: 160 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  checksum?: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 6, default: 1000 })
  position: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TaskFileStatus;

  @Column({ name: 'client_upload_id', length: 160 })
  clientUploadId: string;

  @Column({ name: 'uploaded_by_id', type: 'int', nullable: true })
  uploadedById?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date | null;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'task_id' })
  task?: Task | null;

  @ManyToOne(() => TaskWorkspace, (workspace) => workspace.files, { nullable: true, onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'workspace_id' })
  workspace?: TaskWorkspace | null;
}
