import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ProjectStatus } from '../common/enums/project-status.enum';
import { InvoiceStatus } from '../common/enums/invoice-status.enum';
import { Lead } from './lead.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'project_name', length: 100 })
  projectName: string;

  @Column({ type: 'text', nullable: true })
  overview?: string;

  @Column({ type: 'numeric', array: true, nullable: true })
  payments?: number[];

  @Column({
    name: 'project_status',
    type: 'enum',
    enum: ProjectStatus,
    nullable: true,
  })
  projectStatus?: ProjectStatus;

  @Column({
    name: 'invoice_status',
    type: 'enum',
    enum: InvoiceStatus,
    nullable: true,
  })
  invoiceStatus?: InvoiceStatus;

  @Column({ nullable: true })
  quickbooks?: boolean;

  @Column({ name: 'start_date', type: 'timestamp', nullable: true })
  startDate?: Date;

  @Column({ name: 'end_date', type: 'timestamp', nullable: true })
  endDate?: Date;

  @ManyToOne(() => Lead, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
