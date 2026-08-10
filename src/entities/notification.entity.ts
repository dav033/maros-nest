import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Generic in-app notification. Today only the tasks feature produces these (see
 * TaskNotificationsListener); the table is shaped to take other sources — note
 * mentions, share grants — without a schema change.
 */
export type NotificationKind =
  | 'task_assigned'
  | 'task_commented'
  | 'task_status_changed'
  | 'task_blocked'
  | 'task_due_digest';

@Entity('notifications')
@Index('idx_notifications_user', ['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 40 })
  kind: NotificationKind;

  /** Null when the system generated it — a due-date digest has no human actor. */
  @Column({ name: 'actor_id', type: 'int', nullable: true })
  actorId?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'actor_id' })
  actor?: User | null;

  @Column({ name: 'entity_kind', type: 'varchar', length: 20, nullable: true })
  entityKind?: string | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true })
  entityId?: number | null;

  /**
   * Denormalized title/status so the bell renders without joining the source row, and
   * still reads correctly after the task behind it is renamed or deleted.
   */
  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
