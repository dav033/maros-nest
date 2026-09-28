export interface QboRef {
  value: string;
  name?: string;
}

export interface QboMoney {
  amount: number;
  currencyCode?: string;
}

export interface QboAttachmentSummary {
  attachableId: string;
  fileName: string;
  contentType: string;
  fileSize: number | null;
  note: string;
  entityRefs: Array<{ entityType: string; entityId: string; name?: string }>;
}

export interface QboNormalizedLine {
  lineNum?: number;
  amount: number;
  description: string;
  detailType: string;
  account?: QboRef;
  category?: QboRef;
  item?: QboRef;
  customer?: QboRef;
  billableStatus?: string;
  quantity?: number;
  unitPrice?: number;
  projectRefs: QboRef[];
}

export type QboDirection =
  | 'cash_in'
  | 'cash_out'
  | 'ap_open'
  | 'commitment'
  | 'credit'
  | 'adjustment';

export interface QboAiWarning {
  code: string;
  message: string;
}

export interface QboNormalizedTransaction {
  source: 'quickbooks';
  direction: QboDirection;
  entityType: string;
  entityId: string;
  docNumber: string;
  txnDate: string;
  dueDate?: string;
  /**
   * `null` cuando QuickBooks no expone el importe para esa entidad (p. ej.
   * JournalEntry no tiene TotalAmt). Un importe que no se puede saber no es
   * cero: quien sume decide que hacer con el, igual que con `openBalance`.
   */
  totalAmount: number | null;
  /** Ausente cuando la entidad no expone saldo (p. ej. VendorCredit). */
  openBalance?: number;
  customer?: QboRef;
  vendor?: QboRef;
  projectRefs: QboRef[];
  lineItems: QboNormalizedLine[];
  linkedTxn: Array<{ txnId: string; txnType: string }>;
  account?: QboRef;
  category?: QboRef;
  memo: string;
  description: string;
  billableStatus?: string;
  attachments: QboAttachmentSummary[];
  rawRef?: QboRef;
  status?: string;
  warnings: QboAiWarning[];
}

export interface QboCashInTransaction extends QboNormalizedTransaction {
  direction: 'cash_in';
}

export interface QboCashOutTransaction extends QboNormalizedTransaction {
  direction: 'cash_out';
}

export interface QboVendorSummary {
  vendorId: string;
  displayName: string;
  email?: string;
  phone?: string;
  balance?: number;
  currency?: string;
  active: boolean;
}

export interface QboProjectFinancialSummary {
  projectRef: string;
  estimatedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  openBalance: number;
  cashOut: number;
  netProfit: number;
}
