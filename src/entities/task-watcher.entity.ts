import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Task } from './task.entity';
import { User } from './user.entity';

/**
 * Who gets notified about a task. Seeded with reporter + assignee at creation, grows
 * with whoever comments — see TasksService. No timestamp: watching isn't an event
 * worth an activity-log entry of its own.
 */
@Entity('task_watchers')
@Index('idx_task_watchers_user', ['userId'])
export class TaskWatcher {
  @PrimaryColumn({ name: 'task_id', type: 'int' })
  taskId: number;

  @PrimaryColumn({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
