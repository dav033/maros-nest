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

  /**
   * LEGACY. Not what was invoiced: in 58 of the 59 projects holding both values this
   * equals `lead.estimate` to the dollar, so it is a copy of the estimate taken at
   * project creation. Mapped only so the next reader stops mistaking it for revenue —
   * 110 rows and existing reads depend on it, so it is left untouched. Billing truth is
   * `billedAmount` / `collectedAmount` below.
   */
  // numeric(10,2) in production, verified against the live schema — not 12,2 like the
  // billing columns below, which are new and could be declared wider.
  @Column({ name: 'invoice_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  invoiceAmount?: string | null;

  /**
   * Sealed by ProjectMapper when the project reaches COMPLETED, and never overwritten
   * afterwards — a date typed in by hand is the real one and outranks the transition
   * timestamp. Without it there is no aging clock for projects that were finished but
   * never invoiced, which is most of them.
   */
  @Column({ name: 'end_date', type: 'timestamp', nullable: true })
  endDate?: Date | null;

  /**
   * The four billing-truth columns. Typed as string because the driver hands NUMERIC and
   * DATE back as strings; declaring them number/Date (as lead.estimate does) promises a
   * type that never actually arrives at runtime.
   *
   * NULL means "nobody recorded this", which is not 0 and not "paid". Collection
   * progress is only ever derived from these — see project-billing.util.ts.
   */
  @Column({ name: 'billed_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  billedAmount?: string | null;

  @Column({ name: 'collected_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  collectedAmount?: string | null;

  @Column({ name: 'billed_at', type: 'date', nullable: true })
  billedAt?: string | null;

  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt?: string | null;

  @OneToOne(() => Lead, { nullable: false, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
