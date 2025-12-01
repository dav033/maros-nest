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
import { LeadType } from '../common/enums/lead-type.enum';
import { Contact } from './contact.entity';
import { ProjectType } from './project-type.entity';
import { LeadClickUpMapping } from './lead-clickup-mapping.entity';

@Entity('leads')
@Index('idx_lead_number_unique', ['leadNumber'], { 
  unique: true, 
  where: '"lead_number" IS NOT NULL' 
})
export class Lead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'lead_number', length: 50, nullable: true })
  leadNumber?: string;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ length: 255, nullable: true })
  location?: string;

  @Column({
    type: 'enum',
    enum: LeadStatus,
    nullable: true,
  })
  status?: LeadStatus;

  @Column({
    name: 'lead_type',
    type: 'enum',
    enum: LeadType,
    nullable: true,
  })
  leadType?: LeadType;

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

  @OneToOne(() => LeadClickUpMapping, (mapping) => mapping.lead)
  clickUpMapping: LeadClickUpMapping;
}
