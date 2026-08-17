import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TaskTemplate } from './task-template.entity';
import { TASK_KINDS, TASK_PRIORITIES } from './task.entity';
import type { TaskKind, TaskPriority } from './task.entity';

@Entity('task_template_items')
export class TaskTemplateItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'template_id', type: 'int' })
  templateId: number;

  @ManyToOne(() => TaskTemplate, (template) => template.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template: TaskTemplate;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 24, default: 'general' })
  kind: TaskKind;

  @Column({ type: 'varchar', length: 10, default: 'normal' })
  priority: TaskPriority;

  @Column({ name: 'offset_days', type: 'int', default: 0 })
  offsetDays: number;

  @Column({ type: 'int', default: 0 })
  position: number;
}
