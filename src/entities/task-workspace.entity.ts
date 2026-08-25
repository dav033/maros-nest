import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskWorkspaceFolder } from './task-workspace-folder.entity';
import { TaskWorkspaceLink } from './task-workspace-link.entity';
import { TaskFile } from './task-file.entity';

export const TASK_WORKSPACE_TYPES = ['system_default', 'custom'] as const;
export type TaskWorkspaceType = (typeof TASK_WORKSPACE_TYPES)[number];

@Entity('task_workspaces')
@Index('idx_task_workspaces_active_title', ['archivedAt', 'title'])
export class TaskWorkspace {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  description?: Record<string, unknown> | null;

  @Column({ name: 'description_text', type: 'text', nullable: true })
  descriptionText?: string | null;

  @Column({ name: 'workspace_type', type: 'varchar', length: 24, default: 'custom' })
  workspaceType: TaskWorkspaceType;

  @Column({ name: 'system_key', type: 'varchar', length: 120, nullable: true, unique: true })
  systemKey?: string | null;

  @Column({ name: 'canonical_job_lead_id', type: 'int', nullable: true, unique: true })
  canonicalJobLeadId?: number | null;

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  archivedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => TaskWorkspaceFolder, (folder) => folder.workspace)
  folders: TaskWorkspaceFolder[];

  @OneToMany(() => TaskWorkspaceLink, (link) => link.workspace)
  links: TaskWorkspaceLink[];

  @OneToMany(() => TaskFile, (file) => file.workspace)
  files: TaskFile[];
}
