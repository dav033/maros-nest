import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { ProjectProgressStatus } from '../common/enums/project-progress-status.enum';
import { Lead } from './lead.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    name: 'project_progress_status',
    type: 'enum',
    enum: ProjectProgressStatus,
    nullable: true,
  })
  projectProgressStatus?: ProjectProgressStatus;

  @Column({ nullable: true })
  quickbooks?: boolean;

  @Column({ type: 'text', nullable: true })
  overview?: string;

  @Column({ type: 'jsonb', nullable: true, name: 'notes' })
  notes?: string[];

  @OneToOne(() => Lead, { nullable: false, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
