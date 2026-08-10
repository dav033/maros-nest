import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { TaskLabel } from './task-label.entity';

/**
 * Closed catalog reflecting how work actually breaks down on a construction job —
 * see PLAN-TAREAS.md section 0.1. `general` is the default so nobody is forced to pick
 * one. Stored as varchar (not a Postgres enum) so growing the list is an INSERT-time
 * concern, not an ALTER TYPE migration — same choice NotePage made for `kind`.
 */
export const TASK_KINDS = [
  'site_visit',
  'estimate',
  'follow_up',
  'permit',
  'inspection',
  'material_order',
  'subcontractor',
  'punch_list',
  'change_order',
  'warranty',
  'safety',
  'general',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** `cancelled` is deliberately left off the board — see TaskBoard; it only shows in the list view. */
export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

@Entity('tasks')
@Index('idx_tasks_board', ['status', 'position'])
@Index('idx_tasks_assignee', ['assigneeUserId'])
@Index('idx_tasks_entity', ['entityKind', 'entityId'])
@Index('idx_tasks_due', ['dueDate'])
@Index('idx_tasks_parent', ['parent'])
export class Task {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * One level only: a subtask cannot itself have subtasks. Enforced in TasksService
   * (real domain error) rather than left to fail silently at the DB.
   */
  @ManyToOne(() => Task, (task) => task.children, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent: Task | null;

  @OneToMany(() => Task, (task) => task.parent)
  children: Task[];

  @Column({ length: 255, default: 'Untitled task' })
  title: string;

  @Column({ type: 'jsonb', default: {} })
  description: Record<string, unknown>;

  @Column({ name: 'description_text', type: 'text', nullable: true })
  descriptionText?: string;

  @Column({ type: 'varchar', length: 24, default: 'general' })
  kind: TaskKind;

  @Column({ type: 'varchar', length: 16, default: 'todo' })
  status: TaskStatus;

  @Column({ type: 'varchar', length: 10, default: 'normal' })
  priority: TaskPriority;

  /** Order within its status column. Sparse; see task-position.util.ts. */
  @Column({ type: 'int', default: 0 })
  position: number;

  // Nullable rather than optional: unassigning has to write a real NULL, and TypeORM
  // reads `undefined` on save as "leave this column alone". `type` has to be explicit —
  // a `number | null` property reflects as Object, which TypeORM rejects. Same pattern
  // as NotePage.entityId.
  @Column({ name: 'assignee_user_id', type: 'int', nullable: true })
  assigneeUserId?: number | null;

  /**
   * Read-only view of assignee_user_id, joined in for the board/list UI.
   * `persistence: false` keeps writes going exclusively through the column above — with
   * both mapped to the same FK, a stale loaded relation would otherwise win and undo an
   * assignment change. Same pattern as NotePage.lastEditedBy.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'assignee_user_id' })
  assignee?: User | null;

  /**
   * Who is accountable for the task getting done, independent of who executes it.
   * Defaults to the creator and keeps receiving due/overdue notices even while the
   * task sits unassigned.
   */
  @Column({ name: 'reporter_id', type: 'int', nullable: true })
  reporterId?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'reporter_id' })
  reporter?: User | null;

  @Column({ name: 'entity_kind', type: 'varchar', length: 20, nullable: true })
  entityKind?: string | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true })
  entityId?: number | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: Date | null;

  /** Required whenever status = 'blocked' — enforced in TasksService; see db CHECK. */
  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason?: string | null;

  /** Stamped on entering 'done', cleared on leaving it. Feeds the digest and reporting. */
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'jsonb', default: [] })
  attachments: string[];

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User | null;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToMany(() => TaskLabel, (label) => label.tasks)
  @JoinTable({
    name: 'task_label_links',
    joinColumn: { name: 'task_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'label_id', referencedColumnName: 'id' },
  })
  labels: TaskLabel[];
}
