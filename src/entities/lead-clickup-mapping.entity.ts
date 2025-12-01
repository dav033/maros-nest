import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Lead } from './lead.entity';

@Entity('lead_clickup_mapping')
export class LeadClickUpMapping {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'lead_id', unique: true })
  leadId: number;

  @Column({ name: 'lead_number' })
  leadNumber: string;

  @Column({ name: 'clickup_task_id' })
  clickUpTaskId: string;

  @Column({ name: 'clickup_task_url', nullable: true })
  clickUpTaskUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToOne(() => Lead, (lead) => lead.clickUpMapping)
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
