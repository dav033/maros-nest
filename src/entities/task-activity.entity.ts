import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Task } from './task.entity';
import { User } from './user.entity';

export const TASK_ACTIVITY_KINDS = [
  'created',
  'status_changed',
  'assigned',
  'unassigned',
  'due_changed',
  'priority_changed',
  'blocked',
  'unblocked',
  'commented',
  'entity_linked',
  'entity_unlinked',
  'attachment_added',
  'subtask_added',
] as const;
export type TaskActivityKind = (typeof TASK_ACTIVITY_KINDS)[number];

/** Append-only. Never updated, never deleted except by the task's own cascade. */
@Entity('task_activity')
@Index('idx_task_activity_task', ['taskId', 'createdAt'])
export class TaskActivity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'task_id', type: 'int' })
  taskId: number;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  /** Null for system-generated entries (none yet, but a due-date sweep would have no actor). */
  @Column({ name: 'actor_id', type: 'int', nullable: true })
  actorId?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'actor_id' })
  actor?: User | null;

  @Column({ type: 'varchar', length: 32 })
  kind: TaskActivityKind;

  @Column({ name: 'from_value', type: 'text', nullable: true })
  fromValue?: string | null;

  @Column({ name: 'to_value', type: 'text', nullable: true })
  toValue?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
