import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InvoiceScanStatus =
  | 'uploaded'
  | 'processing'
  | 'needs_review'
  | 'failed';

export interface ExtractedInvoiceData {
  direction: 'outgoing' | 'incoming' | 'unknown';
  classification:
    | 'customer_service'
    | 'materials_expense'
    | 'subcontractor_expense'
    | 'other'
    | 'unknown';
  counterpartyName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  taxTotal: number | null;
  total: number | null;
  paymentStatus: 'paid' | 'unpaid' | 'unknown';
  confidence: number;
  lineItems: Array<{
    description: string;
    quantity: number | null;
    unitPrice: number | null;
    amount: number | null;
  }>;
}

@Entity('invoice_scans')
@Index('idx_invoice_scans_created_at', ['createdAt'])
@Index('idx_invoice_scans_status', ['status'])
export class InvoiceScan {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'file_key', type: 'text' })
  fileKey: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ type: 'varchar', length: 20, default: 'uploaded' })
  status: InvoiceScanStatus;

  @Column({ name: 'extracted_data', type: 'jsonb', nullable: true })
  extractedData: ExtractedInvoiceData | null;

  @Column({ name: 'qbo_suggestions', type: 'jsonb', default: () => "'{}'::jsonb" })
  qboSuggestions: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'project_number', type: 'varchar', length: 50, nullable: true })
  projectNumber: string | null;

  /** Non-fatal problems found while scanning (unreadable field, QuickBooks down…). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  warnings: string[];

  /** Set when the invoice has been entered in QuickBooks; null while pending. */
  @Column({ name: 'entered_at', type: 'timestamptz', nullable: true })
  enteredAt: Date | null;

  @Column({ name: 'entered_by', type: 'integer', nullable: true })
  enteredBy: number | null;

  /** When the "ready to review" email went out. */
  @Column({ name: 'notified_at', type: 'timestamptz', nullable: true })
  notifiedAt: Date | null;

  /** Last pending-invoice reminder that listed this scan. */
  @Column({ name: 'reminded_at', type: 'timestamptz', nullable: true })
  remindedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
