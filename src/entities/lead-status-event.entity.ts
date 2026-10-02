import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { LeadStatus } from '../common/enums/lead-status.enum';

/**
 * One recorded move of a lead from one pipeline stage to another.
 *
 * `leads.status` is a position, not a history, so nothing could say how long a proposal
 * sits before it closes or which stage deals die in. Rows here are append-only: a status
 * typed in by mistake is fixed by moving the lead again, which writes another row.
 *
 * See db/add-lead-sales-fields.sql for why the status columns are varchar and not the
 * enum they describe.
 */
@Entity('lead_status_events')
@Index('idx_lead_status_events_lead', ['leadId', 'changedAt'])
export class LeadStatusEvent {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Scalar rather than a ManyToOne: nothing reads a lead back through its history, and a
   * mapped relation would let a stale loaded Lead be re-saved as a side effect of writing
   * an event. The CASCADE lives in the migration.
   */
  @Column({ name: 'lead_id', type: 'int' })
  leadId: number;

  /** NULL for the first move of a lead whose status was never set — 27 production rows. */
  @Column({ name: 'from_status', type: 'varchar', length: 40, nullable: true })
  fromStatus?: LeadStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 40 })
  toStatus: LeadStatus;

  /** NULL when the move came from a path with no signed-in user: MCP tools, jobs. */
  @Column({ name: 'changed_by_id', type: 'int', nullable: true })
  changedById?: number | null;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt: Date;
}
