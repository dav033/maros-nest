import { Entity, PrimaryGeneratedColumn, Column, ManyToMany } from 'typeorm';
import { Task } from './task.entity';

@Entity('task_labels')
export class TaskLabel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, unique: true })
  name: string;

  @Column({ length: 20, default: 'neutral' })
  color: string;

  @ManyToMany(() => Task, (task) => task.labels)
  tasks: Task[];
}
