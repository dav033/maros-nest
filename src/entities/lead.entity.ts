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

  @Column({ type: 'jsonb', nullable: true, name: 'attachments', default: [] })
  attachments?: string[];

  // Estimado manual editable desde el CRM. Independiente del Estimate real de
  // QuickBooks (vía ProjectQboEnrichmentService, expuesto como financial.estimatedAmount).
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, name: 'estimate' })
  estimate?: number;

  @Column({ name: 'in_review', type: 'boolean', default: false })
  inReview: boolean;

  // The four sales-analytics columns are `| null`, not optional. Clearing one has to write
  // a real NULL and TypeORM reads `undefined` on save as "leave this column alone", so an
  // unassign or a cleared loss reason would silently no-op (same trap documented on
  // NotePage.entityKind). `type` must be explicit too: a `string | null` property reflects
  // as Object, which TypeORM rejects.
  @Column({ name: 'owner_id', type: 'int', nullable: true })
  ownerId?: number | null;

  // Typed as plain strings here while the accepted vocabulary lives with the DTO that
  // validates it (LEAD_SOURCES / LEAD_LOST_REASONS) — entities must not import from
  // modules/, and the column is deliberately wider than any current list. See
  // db/add-lead-sales-fields.sql.
  @Column({ type: 'varchar', length: 40, nullable: true })
  source?: string | null;

  @Column({ name: 'lost_reason', type: 'varchar', length: 40, nullable: true })
  lostReason?: string | null;

  // Kept as the raw 'YYYY-MM-DD' Postgres hands back for a DATE. Parsing it into a Date
  // moves it a day in negative-offset timezones, which is the bug LeadMapper.toDto already
  // works around for start_date.
  @Column({ name: 'next_follow_up_at', type: 'date', nullable: true })
  nextFollowUpAt?: string | null;

  // Stamped by LeadsService.updateLead whenever the status actually moves. NULL on every
  // row that predates the column, because nothing recorded the date to backfill it from —
  // time-in-stage reports have to exclude those rather than treat them as ancient.
  @Column({ name: 'status_changed_at', type: 'timestamp', nullable: true })
  statusChangedAt?: Date | null;

  @ManyToOne(() => Contact, (contact) => contact.leads, { nullable: true })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact | null;

  @ManyToOne(() => ProjectType, (projectType) => projectType.leads, {
    nullable: true,
  })
  @JoinColumn({ name: 'type' })
  projectType: ProjectType;

  @OneToOne(() => Project, (project) => project.lead)
  project: Project;
}
