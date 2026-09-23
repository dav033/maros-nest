import type { ExtractedInvoiceData } from '../../entities/invoice-scan.entity';

/**
 * Runtime validation of the JSON OpenAI returns for an invoice. The response
 * is external input: the schema is enforced by OpenAI's structured outputs,
 * but a model can still emit an impossible date or a negative total. A bad
 * field becomes null plus a warning; it never aborts the scan.
 */
export interface ParsedInvoiceExtraction {
  data: ExtractedInvoiceData;
  /** Project/job number printed on the document, if the model spotted one. */
  projectNumberHint: string | null;
  warnings: string[];
}

export const DIRECTIONS = ['outgoing', 'incoming', 'unknown'] as const;
export const CLASSIFICATIONS = [
  'customer_service',
  'materials_expense',
  'subcontractor_expense',
  'other',
  'unknown',
] as const;
export const PAYMENT_STATUSES = ['paid', 'unpaid', 'unknown'] as const;

/** Below this the extraction is flagged so the reviewer double-checks every field. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Raw = Record<string, unknown>;

export function emptyExtractedInvoice(): ExtractedInvoiceData {
  return {
    direction: 'unknown',
    classification: 'unknown',
    counterpartyName: null,
    invoiceNumber: null,
    issueDate: null,
    dueDate: null,
    currency: null,
    subtotal: null,
    taxTotal: null,
    total: null,
    paymentStatus: 'unknown',
    confidence: 0,
    lineItems: [],
  };
}

export function parseInvoiceExtraction(input: unknown): ParsedInvoiceExtraction {
  const warnings: string[] = [];
  const raw: Raw =
    input !== null && typeof input === 'object' ? (input as Raw) : {};
  if (raw !== input) {
    warnings.push('The scanner returned no readable fields; fill them in by hand.');
  }

  const data = emptyExtractedInvoice();
  data.direction = readEnum(raw, 'direction', DIRECTIONS, 'unknown', 'Document type', warnings);
  data.classification = readEnum(
    raw,
    'classification',
    CLASSIFICATIONS,
    'unknown',
    'Category',
    warnings,
  );
  data.paymentStatus = readEnum(
    raw,
    'payment_status',
    PAYMENT_STATUSES,
    'unknown',
    'Payment status',
    warnings,
  );
  data.counterpartyName = readText(raw, 'counterparty_name', 'Company / customer', warnings);
  data.invoiceNumber = readText(raw, 'invoice_number', 'Invoice number', warnings);
  data.issueDate = readDate(raw, 'issue_date', 'Issue date', warnings);
  data.dueDate = readDate(raw, 'due_date', 'Due date', warnings);
  data.currency = readCurrency(raw, warnings);
  data.subtotal = readAmount(raw, 'subtotal', 'Subtotal', warnings);
  data.taxTotal = readAmount(raw, 'tax_total', 'Tax', warnings);
  data.total = readAmount(raw, 'total', 'Total', warnings);
  data.confidence = readConfidence(raw, warnings);
  data.lineItems = readLineItems(raw, warnings);

  if (data.total === null) {
    warnings.push('The invoice total could not be read; enter it from the document.');
  } else if (
    data.subtotal !== null &&
    data.taxTotal !== null &&
    Math.abs(data.subtotal + data.taxTotal - data.total) > 0.05
  ) {
    warnings.push('Subtotal plus tax does not add up to the total; check the amounts.');
  }
  if (data.confidence < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push(
      `Low extraction confidence (${Math.round(data.confidence * 100)}%); compare every field with the document.`,
    );
  }

  return {
    data,
    projectNumberHint: readText(raw, 'project_number', 'Project number', warnings),
    warnings,
  };
}

function readEnum<T extends string>(
  raw: Raw,
  key: string,
  allowed: readonly T[],
  fallback: T,
  label: string,
  warnings: string[],
): T {
  const value = raw[key];
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  if (value !== undefined && value !== null) {
    warnings.push(`${label} was not recognised; review it.`);
  }
  return fallback;
}

function readText(raw: Raw, key: string, label: string, warnings: string[]): string | null {
  const value = raw[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 255) : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  warnings.push(`${label} could not be read; enter it from the document.`);
  return null;
}

function readDate(raw: Raw, key: string, label: string, warnings: string[]): string | null {
  const value = readText(raw, key, label, warnings);
  if (value === null) return null;
  if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return value;
  warnings.push(`${label} "${value}" is not a valid date; enter it from the document.`);
  return null;
}

function readCurrency(raw: Raw, warnings: string[]): string | null {
  const value = readText(raw, 'currency', 'Currency', warnings);
  if (value === null) return null;
  const code = value.toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) return code;
  if (value === '$') return 'USD';
  warnings.push(`Currency "${value}" was not recognised; USD is assumed unless you change it.`);
  return 'USD';
}

function readAmount(raw: Raw, key: string, label: string, warnings: string[]): number | null {
  const value = raw[key];
  if (value === null || value === undefined) return null;
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    warnings.push(`${label} could not be read; enter it from the document.`);
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function readConfidence(raw: Raw, warnings: string[]): number {
  const value = raw.confidence;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  warnings.push('The scanner reported no confidence score.');
  return 0;
}

function readLineItems(raw: Raw, warnings: string[]): ExtractedInvoiceData['lineItems'] {
  const value = raw.line_items;
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push('Line items could not be read; add them by hand if you need them.');
    return [];
  }
  const items: ExtractedInvoiceData['lineItems'] = [];
  let skipped = 0;
  for (const entry of value.slice(0, 200)) {
    if (entry === null || typeof entry !== 'object') {
      skipped += 1;
      continue;
    }
    const line = entry as Raw;
    const description =
      typeof line.description === 'string' ? line.description.trim().slice(0, 500) : '';
    const quantity = optionalNumber(line.quantity);
    const unitPrice = optionalNumber(line.unit_price);
    const amount = optionalNumber(line.amount);
    if (!description && quantity === null && unitPrice === null && amount === null) {
      skipped += 1;
      continue;
    }
    items.push({ description, quantity, unitPrice, amount });
  }
  if (skipped > 0) {
    warnings.push(
      `${skipped} line item${skipped === 1 ? '' : 's'} could not be read and ${skipped === 1 ? 'was' : 'were'} left out.`,
    );
  }
  return items;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/** "1,250.50" and "$80" are numbers; "n/a" or "" are not (Number('') would be 0). */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  return cleaned.length === 0 ? Number.NaN : Number(cleaned);
}
