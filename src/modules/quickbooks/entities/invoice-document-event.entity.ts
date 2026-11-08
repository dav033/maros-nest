import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { InvoiceDocumentStatus } from './invoice-document-location.entity';

/** Append-only history of the changes made to an invoice document location. */
@Entity('invoice_document_events')
export class InvoiceDocumentEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index('idx_invoice_document_events_location')
  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus: InvoiceDocumentStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus: InvoiceDocumentStatus;

  @Column({ name: 'drive_folder', type: 'varchar', length: 500, nullable: true })
  driveFolder: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Who or what made the change: an email, or `mcp` / `system`. */
  @Column({ type: 'varchar', length: 255 })
  actor: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
