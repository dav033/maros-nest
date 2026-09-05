import {
  QboAttachmentSummary,
  QboCashInTransaction,
  QboCashOutTransaction,
  QboNormalizedTransaction,
} from '../core/quickbooks-normalizer.service';

export interface ProjectFinancials {
  projectNumber: string;
  found: boolean;
  estimatedAmount: number;
  estimateCount: number;
  invoicedAmount: number;
  invoiceCount: number;
  paidAmount: number;
  outstandingAmount: number;
  paidPercentage: number;
  estimateVsInvoicedDelta: number;
  paymentSchedule?: PaymentSchedule;
}

/**
 * Sobre qué monto se calcula un porcentaje del cronograma. Los proposals de
 * Maros mezclan ambos: hitos como "35% of Remaining Balance" se calculan sobre
 * el saldo tras descontar los pagos fijos, no sobre el total del estimate.
 */
export type PaymentScheduleBasis = 'total' | 'remaining-balance';

export interface PaymentScheduleItem {
  label: string;
  /** null en hitos de monto fijo ("Fixed Amount $5,000.00"). */
  percentage: number | null;
  amount: number | null;
  basis?: PaymentScheduleBasis;
}

export interface PaymentSchedule {
  items: PaymentScheduleItem[];
  totalPercentage: number | null;
  totalAmount: number | null;
  /** Base predominante de los porcentajes; 'remaining-balance' si algún hito lo es. */
  basis: PaymentScheduleBasis;
  source: {
    attachmentId: string;
    fileName: string;
    entityType: 'Estimate' | 'Invoice' | 'Customer' | null;
    entityId: string | null;
    /**
     * Cómo se ligó el PDF al proyecto. 'file-name' es una heurística: hay
     * proposals mal nombrados en QBO, así que la UI debe advertirlo.
     */
    matchedBy: 'estimate' | 'invoice' | 'customer' | 'file-name';
  };
}

export type InvoiceSummary = QboCashInTransaction;

export interface UnbilledWorkResult {
  projectNumber: string;
  found: boolean;
  job: Record<string, unknown> | null;
  totalEstimated: number;
  totalInvoiced: number;
  unbilledAmount: number;
  estimates: QboNormalizedTransaction[];
  invoices: QboCashInTransaction[];
}

export interface ProjectDetail {
  projectNumber: string;
  found: boolean;
  job: Record<string, unknown> | null;
  financials: Omit<ProjectFinancials, 'projectNumber' | 'found'>;
  estimates: QboNormalizedTransaction[];
  invoices: QboCashInTransaction[];
  payments: QboCashInTransaction[];
}

export type ExpenseItem = QboCashOutTransaction;

export type AttachmentItem = QboAttachmentSummary;

export interface PnlCategory {
  name: string;
  amount: number;
}

export interface ProjectProfitAndLoss {
  projectNumber: string;
  found: boolean;
  customerId: string | null;
  income: { total: number; categories: PnlCategory[] };
  costOfGoodsSold: { total: number; categories: PnlCategory[] };
  expenses: { total: number; categories: PnlCategory[] };
  grossProfit: number;
  netProfit: number;
}

export interface ProjectFullProfile {
  projectNumber: string;
  found: boolean;
  job: Record<string, unknown> | null;
  financials: Omit<ProjectFinancials, 'projectNumber' | 'found'>;
  estimates: QboNormalizedTransaction[];
  invoices: QboCashInTransaction[];
  payments: QboCashInTransaction[];
  expenses: ExpenseItem[];
  attachments: AttachmentItem[];
  profitAndLoss: ProjectProfitAndLoss | null;
}

export interface QboCustomer {
  Id: string;
  DisplayName: string;
  [key: string]: unknown;
}

export interface QboTxnBase {
  Id: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string } | string;
  [key: string]: unknown;
}

export interface QboInvoice extends QboTxnBase {
  Balance: number;
}

export interface QboCustomerResponse {
  QueryResponse?: { Customer?: QboCustomer[] };
}

export interface QboEstimateResponse {
  QueryResponse?: { Estimate?: QboTxnBase[] };
}

export interface QboInvoiceResponse {
  QueryResponse?: { Invoice?: QboInvoice[] };
}

export interface QboPaymentResponse {
  QueryResponse?: { Payment?: Record<string, unknown>[] };
}

export interface JobContext {
  jobMap: Record<string, string>;
  jobObjectMap: Record<string, QboCustomer>;
  jobIds: string[];
}

export interface AttachmentEntityRef {
  entityType: string;
  entityId: string;
}

