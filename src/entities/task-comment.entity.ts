import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Task } from './task.entity';
import { User } from './user.entity';

@Entity('task_comments')
@Index('idx_task_comments_task', ['taskId', 'createdAt'])
export class TaskComment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'task_id', type: 'int' })
  taskId: number;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'author_id', type: 'int', nullable: true })
  authorId?: number | null;

  /** `persistence: false` — see Task.assignee for why the column above must always win. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'author_id' })
  author?: User | null;

  @Column({ type: 'jsonb', default: {} })
  body: Record<string, unknown>;

  @Column({ name: 'body_text', type: 'text', nullable: true })
  bodyText?: string;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
