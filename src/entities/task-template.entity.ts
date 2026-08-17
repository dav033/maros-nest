import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TaskTemplateItem } from './task-template-item.entity';

@Entity('task_templates')
export class TaskTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 120 })
  name: string;

  @Column({ name: 'project_type', type: 'varchar', length: 80, nullable: true })
  projectType?: string | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => TaskTemplateItem, (item) => item.template, { cascade: true })
  items: TaskTemplateItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
