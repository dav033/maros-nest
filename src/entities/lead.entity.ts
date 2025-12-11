import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { LeadStatus } from '../common/enums/lead-status.enum';
import { Contact } from './contact.entity';
import { ProjectType } from './project-type.entity';
import { Project } from './project.entity';

@Entity('leads')
@Index('idx_lead_number_unique', ['leadNumber'], {
  unique: true,
  where: '"lead_number" IS NOT NULL',
})
export class Lead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'lead_number', length: 50, nullable: true })
  leadNumber?: string;

  @Column({ length: 100, nullable: true })
  name?: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date;

  @Column({ length: 255, nullable: true })
  location?: string;

  @Column({ name: 'address_link', length: 500, nullable: true })
  addressLink?: string;

  @Column({
    type: 'enum',
    enum: LeadStatus,
    nullable: true,
  })
  status?: LeadStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'notes' })
  notes?: string[];

  @ManyToOne(() => Contact, (contact) => contact.leads, { nullable: true })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => ProjectType, (projectType) => projectType.leads, {
    nullable: true,
  })
  @JoinColumn({ name: 'type' })
  projectType: ProjectType;

  @OneToOne(() => Project, (project) => project.lead)
  project: Project;
}
