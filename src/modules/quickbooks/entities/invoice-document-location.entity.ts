import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * in_receipts: just filed. categorized: Alexandra categorised it in QuickBooks.
 * moved: moved to its final folder. removed: no longer in Drive.
 */
export type InvoiceDocumentStatus = 'in_receipts' | 'categorized' | 'moved' | 'removed';

export const INVOICE_DOCUMENT_STATUSES: readonly InvoiceDocumentStatus[] = [
  'in_receipts',
  'categorized',
  'moved',
  'removed',
];

/** Where one invoice document lives in Google Drive (one row per Drive file). */
@Entity('invoice_document_locations')
export class InvoiceDocumentLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_invoice_document_locations_scan')
  @Column({ name: 'invoice_scan_id', type: 'uuid' })
  invoiceScanId: string;

  @Column({ name: 'drive_file_id', type: 'text', unique: true })
  driveFileId: string;

  @Column({ name: 'drive_url', type: 'text', nullable: true })
  driveUrl: string | null;

  @Column({ name: 'drive_name', type: 'varchar', length: 255 })
  driveName: string;

  @Column({ name: 'drive_folder', type: 'varchar', length: 500 })
  driveFolder: string;

  @Column({ type: 'varchar', length: 20, default: 'in_receipts' })
  status: InvoiceDocumentStatus;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
