import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Task } from './task.entity';

@Entity('task_dependencies')
export class TaskDependency {
  @PrimaryColumn({ name: 'task_id', type: 'int' })
  taskId: number;

  @PrimaryColumn({ name: 'depends_on_task_id', type: 'int' })
  dependsOnTaskId: number;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'depends_on_task_id' })
  dependsOnTask: Task;
}
