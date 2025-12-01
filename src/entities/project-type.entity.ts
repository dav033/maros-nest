import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Project } from './project.entity';
import { Lead } from './lead.entity';

@Entity('project_type')
export class ProjectType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  name?: string;

  @Column({ type: 'text', nullable: true })
  color?: string;

  @OneToMany(() => Lead, (lead) => lead.projectType)
  leads: Lead[];
}
