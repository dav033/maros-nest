import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TaskWorkspace } from './task-workspace.entity';

export const TASK_WORKSPACE_ENTITY_KINDS = ['lead', 'project', 'contact', 'company'] as const;
export type TaskWorkspaceEntityKind = (typeof TASK_WORKSPACE_ENTITY_KINDS)[number];
export const TASK_WORKSPACE_RELATIONSHIPS = ['primary', 'related', 'client', 'supplier', 'subcontractor', 'contact'] as const;
export type TaskWorkspaceRelationship = (typeof TASK_WORKSPACE_RELATIONSHIPS)[number];

@Entity('task_workspace_links')
@Index('idx_task_workspace_links_entity', ['entityKind', 'entityId'])
export class TaskWorkspaceLink {
  @PrimaryColumn({ name: 'workspace_id', type: 'int' })
  workspaceId: number;

  @PrimaryColumn({ name: 'entity_kind', type: 'varchar', length: 16 })
  entityKind: TaskWorkspaceEntityKind;

  @PrimaryColumn({ name: 'entity_id', type: 'int' })
  entityId: number;

  @Column({ type: 'varchar', length: 32, default: 'related' })
  relationship: TaskWorkspaceRelationship;

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => TaskWorkspace, (workspace) => workspace.links, { onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'workspace_id' })
  workspace?: TaskWorkspace;
}
