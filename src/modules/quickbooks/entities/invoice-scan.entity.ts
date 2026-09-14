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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
