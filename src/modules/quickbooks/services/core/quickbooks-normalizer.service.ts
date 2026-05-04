import { Injectable } from '@nestjs/common';
import { normalizeAttachable } from './normalizers/attachable.normalizer';
import { normalizeBill } from './normalizers/bill.normalizer';
import { normalizeBillPayment } from './normalizers/bill-payment.normalizer';
import { normalizeEstimate } from './normalizers/estimate.normalizer';
import { normalizeInvoice } from './normalizers/invoice.normalizer';
import { normalizeJournalEntry } from './normalizers/journal-entry.normalizer';
import { normalizePayment } from './normalizers/payment.normalizer';
import { normalizePurchase } from './normalizers/purchase.normalizer';
import { normalizePurchaseOrder } from './normalizers/purchase-order.normalizer';
import { normalizeVendor } from './normalizers/vendor.normalizer';
import { normalizeVendorCredit } from './normalizers/vendor-credit.normalizer';
import {
  dedupeWarnings,
  extractRef,
  warning,
} from './quickbooks-normalizer.utils';
import {
  QboAiWarning,
  QboAttachmentSummary,
  QboCashInTransaction,
  QboCashOutTransaction,
  QboNormalizedTransaction,
  QboRef,
  QboVendorSummary,
} from './quickbooks-normalizer.types';

export * from './quickbooks-normalizer.types';

@Injectable()
export class QuickbooksNormalizerService {
  normalizeInvoice(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashInTransaction {
    return normalizeInvoice(raw, attachments);
  }

  normalizeEstimate(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    return normalizeEstimate(raw, attachments);
  }

  normalizePayment(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashInTransaction {
    return normalizePayment(raw, attachments);
  }

  normalizePurchase(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashOutTransaction {
    return normalizePurchase(raw, attachments);
  }

  normalizeBill(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    return normalizeBill(raw, attachments);
  }

  normalizeBillPayment(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashOutTransaction {
    return normalizeBillPayment(raw, attachments);
  }

  normalizeVendorCredit(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    return normalizeVendorCredit(raw, attachments);
  }

  normalizePurchaseOrder(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    return normalizePurchaseOrder(raw, attachments);
  }

  normalizeJournalEntry(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    return normalizeJournalEntry(raw, attachments);
  }

  normalizeVendor(raw: Record<string, unknown>): QboVendorSummary {
    return normalizeVendor(raw);
  }

  normalizeAttachable(raw: Record<string, unknown>): QboAttachmentSummary {
    return normalizeAttachable(raw);
  }

  extractRef(raw: unknown): QboRef | undefined {
    return extractRef(raw);
  }

  warning(code: string, message: string): QboAiWarning {
    return warning(code, message);
  }

  dedupeWarnings(warnings: QboAiWarning[]): QboAiWarning[] {
    return dedupeWarnings(warnings);
  }
}
