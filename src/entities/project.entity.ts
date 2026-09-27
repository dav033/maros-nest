import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProjectProgressStatus } from '../common/enums/project-progress-status.enum';
import { Lead } from './lead.entity';

@Entity('projects')
@Index('idx_projects_qbo_customer_id_unique', ['qboCustomerId'], {
  unique: true,
  where: '"qbo_customer_id" IS NOT NULL',
})
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

  @Column({ name: 'qbo_customer_id', type: 'varchar', length: 50, nullable: true })
  qboCustomerId?: string | null;

  @Column({ type: 'text', nullable: true })
  overview?: string;

  @Column({ type: 'jsonb', nullable: true, name: 'notes' })
  notes?: string[];

  @Column({ type: 'jsonb', nullable: true, name: 'attachments', default: [] })
  attachments?: string[];

  @OneToOne(() => Lead, { nullable: false, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
