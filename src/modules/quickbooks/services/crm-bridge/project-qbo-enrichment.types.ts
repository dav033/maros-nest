import {
  ProjectFinancials,
  ProjectFullProfile,
} from '../financials/quickbooks-financials.types';
import { InvoiceStatus } from '../../../../common/enums/invoice-status.enum';

export interface QboPaymentSummary {
  id?: string;
  date?: string;
  /** `null` si QuickBooks no expuso el importe: desconocido, no cero. */
  amount: number | null;
  method?: string;
  reference?: string;
  linkedInvoice?: string;
}

export interface QboProjectPaymentSummary {
  count: number;
  totalAmount: number;
  lastPaymentDate: string | null;
  hasDetails: boolean;
}

export interface QboEnrichmentError {
  code: 'qbo_connection_required' | 'qbo_query_failed';
  message: string;
}

export interface QboProjectSummary
  extends Omit<ProjectFinancials, 'projectNumber'> {
  projectNumber: string;
  totalJobCost?: number;
  grossProfit?: number;
  cashOutPaid?: number;
  payments?: QboPaymentSummary[];
  paymentSummary?: QboProjectPaymentSummary;
  invoiceStatus?: InvoiceStatus;
  /**
   * El cronograma de pagos aun no se ha leido de los PDF. Distingue "todavia
   * no se sabe" de "este proyecto no tiene cronograma", que es la ausencia de
   * `paymentSchedule` sin esta bandera.
   */
  paymentSchedulePending?: boolean;
}

export type QboProjectFullProfile = ProjectFullProfile & {
  invoiceStatus?: InvoiceStatus;
};

export interface QboEnrichmentBlock<
  T extends QboProjectSummary | QboProjectFullProfile = QboProjectSummary,
> {
  data: T | null;
  error?: QboEnrichmentError;
}

export interface EnrichmentOptions {
  depth?: 'summary' | 'full';
  realmId?: string;
  includeJobCosts?: boolean;
}
