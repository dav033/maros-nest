import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Index, UpdateDateColumn } from 'typeorm';
import { TaskWorkspace } from './task-workspace.entity';

@Entity('task_workspace_folders')
@Index('idx_task_workspace_folders_workspace_position', ['workspaceId', 'parentFolderId', 'position', 'id'])
export class TaskWorkspaceFolder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'workspace_id', type: 'int' })
  workspaceId: number;

  @Column({ name: 'parent_folder_id', type: 'int', nullable: true })
  parentFolderId?: number | null;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'numeric', precision: 20, scale: 6, default: 1000 })
  position: number;

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => TaskWorkspace, (workspace) => workspace.folders, { onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'workspace_id' })
  workspace?: TaskWorkspace;

  @ManyToOne(() => TaskWorkspaceFolder, (folder) => folder.children, { nullable: true, onDelete: 'RESTRICT', persistence: false })
  @JoinColumn({ name: 'parent_folder_id' })
  parent?: TaskWorkspaceFolder | null;

  @OneToMany(() => TaskWorkspaceFolder, (folder) => folder.parent)
  children: TaskWorkspaceFolder[];
}
