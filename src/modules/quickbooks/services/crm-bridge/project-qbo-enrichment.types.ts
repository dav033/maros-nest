import {
  ProjectFinancials,
  ProjectFullProfile,
} from '../financials/quickbooks-financials.types';
import { InvoiceStatus } from '../../../../common/enums/invoice-status.enum';

export interface QboPaymentSummary {
  id?: string;
  date?: string;
  amount: number;
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
  payments?: QboPaymentSummary[];
  paymentSummary?: QboProjectPaymentSummary;
  invoiceStatus?: InvoiceStatus;
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
}
