import { extensionFor } from './workspace-input';

/**
 * Standard invoice file name: `Project-Vendor-Amount.ext`, e.g.
 * `064P-HomeDepot-1250.00.pdf`.
 *
 * - Project: the short code (`064P` for `064P-0826`). A full number given by the
 *   caller is reduced the same way.
 * - Vendor: accents, store numbers and legal words dropped, words joined in
 *   PascalCase (`The Home Depot #4021` -> `HomeDepot`).
 * - Amount: plain decimal, two digits, no thousands separator. USD is implied;
 *   any other currency is appended (`1250.00EUR`).
 *
 * Nothing is guessed: a missing field is reported, never replaced by a default,
 * so a half-filled name can never be filed.
 */

const LEGAL_WORDS = new Set([
  'the', 'inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'and', 'of', 'dba',
]);

export interface InvoiceNameInput {
  project: string | null | undefined;
  vendor: string | null | undefined;
  amount: number | null | undefined;
  currency?: string | null;
  fileName: string;
  contentType: string | null;
}

export type InvoiceNameField = 'project' | 'vendor' | 'amount';

export interface InvoiceNameResult {
  /** Final name when every field is present. */
  name: string | null;
  /** Fields that could not be filled; the name is null when this is not empty. */
  missing: InvoiceNameField[];
}

export function projectShortCode(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const short = /^(\d{3}P?)(?:-\d{4})?$/.exec(trimmed)?.[1];
  if (short) return short;
  const cleaned = trimmed.replace(/[^A-Z0-9-]/g, '');
  return cleaned.length > 0 ? cleaned.replace(/-+$/g, '') : null;
}

export function normalizeVendor(value: string): string | null {
  const words = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !LEGAL_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return null;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
}

export function formatAmount(amount: number, currency?: string | null): string {
  const fixed = Math.abs(amount).toFixed(2);
  const code = currency?.trim().toUpperCase();
  return code && code !== 'USD' ? `${fixed}${code}` : fixed;
}

export function buildInvoiceFileName(input: InvoiceNameInput): InvoiceNameResult {
  const project = input.project?.trim() ? projectShortCode(input.project) : null;
  const vendor = input.vendor?.trim() ? normalizeVendor(input.vendor) : null;
  const hasAmount = typeof input.amount === 'number' && Number.isFinite(input.amount);

  const missing: InvoiceNameField[] = [];
  if (!project) missing.push('project');
  if (!vendor) missing.push('vendor');
  if (!hasAmount) missing.push('amount');
  if (missing.length > 0) return { name: null, missing };

  const extension = extensionFor(input.fileName, input.contentType);
  const amount = formatAmount(input.amount as number, input.currency);
  return { name: `${project}-${vendor}-${amount}.${extension}`, missing: [] };
}

/** `a.pdf` -> `a-2.pdf`, `a-2.pdf` -> `a-3.pdf` when the name is already taken. */
export function withCounter(name: string, counter: number): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  return `${stem}-${counter}${extension}`;
}
