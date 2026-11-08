import type {
  InvoiceScan,
  InvoiceScanStatus,
} from '../../entities/invoice-scan.entity';

/**
 * Search over the invoice index (`invoice_scans`): which documents exist for a
 * set of projects and vendors, and which requested (project, vendor) pairs have
 * none. Pure functions only; the service does the query and hands rows here so
 * the matching rules are testable without a database.
 */

export interface InvoiceSearchInput {
  /** Project numbers, either the short form (`064P`) or the full one (`064P-0826`). */
  projects: string[];
  /** Vendor names as people say them (`Lion`, `Home Depot`). Empty = every vendor. */
  vendors: string[];
  dateFrom?: string;
  dateTo?: string;
}

export type InvoiceDocumentIssue =
  | 'no_file'
  | 'scan_failed'
  | 'needs_review'
  | 'not_entered_in_quickbooks'
  | 'no_total'
  | 'no_date';

/** Where the document lives in Drive, from the invoice index (empty until it is filed there). */
export interface InvoiceDocumentLocationSummary {
  status: string;
  driveUrl: string | null;
  driveName: string;
  driveFolder: string;
  receivedAt: Date;
  updatedAt: Date;
}

export interface InvoiceSearchDocument {
  id: string;
  url: string;
  projectNumber: string | null;
  fileName: string;
  vendor: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  total: number | null;
  currency: string | null;
  paymentStatus: 'paid' | 'unpaid' | 'unknown';
  status: InvoiceScanStatus;
  enteredInQuickbooks: boolean;
  hasFile: boolean;
  issues: InvoiceDocumentIssue[];
  locations: InvoiceDocumentLocationSummary[];
}

export interface InvoiceSearchGroup {
  project: string;
  vendor: string | null;
  found: boolean;
  documents: InvoiceSearchDocument[];
}

export interface InvoiceSearchMissing {
  project: string;
  vendor: string;
  reason: string;
  /** Documents of that vendor with no project assigned: likely candidates. */
  possibleUnassigned: InvoiceSearchDocument[];
}

export interface InvoiceSearchReport {
  query: {
    projects: string[];
    vendors: string[];
    dateFrom: string | null;
    dateTo: string | null;
  };
  summary: {
    documents: number;
    requestedPairs: number;
    foundPairs: number;
    missingPairs: number;
    totalsByCurrency: Record<string, number>;
  };
  results: InvoiceSearchGroup[];
  missing: InvoiceSearchMissing[];
}

const LEGAL_WORDS = new Set([
  'the',
  'inc',
  'llc',
  'ltd',
  'corp',
  'corporation',
  'co',
  'company',
  'and',
  'of',
]);

/** Lowercase, no accents, punctuation turned into spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function significantTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 0 && !LEGAL_WORDS.has(token));
}

/**
 * A vendor query matches when every significant word of it appears as a whole
 * word in the document's counterparty name (or, when the scan has no
 * counterparty yet, in its file name). "Home Depot" matches "The Home Depot
 * #4021"; "Bond" does not match "Bonds & Co" by accident of substring.
 */
export function vendorMatches(
  query: string,
  counterpartyName: string | null,
  fileName: string,
): boolean {
  const wanted = significantTokens(query);
  if (wanted.length === 0) return false;
  const haystack = new Set(
    significantTokens(counterpartyName?.trim() ? counterpartyName : fileName),
  );
  return wanted.every((token) => haystack.has(token));
}

/**
 * `064P` selects `064P-0826` and `064P-0127`; a full number selects only itself.
 * Case-insensitive, like the numbers on invoices.
 */
export function projectMatches(
  requested: string,
  projectNumber: string | null,
): boolean {
  if (!projectNumber) return false;
  const wanted = requested.trim().toUpperCase();
  const actual = projectNumber.trim().toUpperCase();
  if (wanted.includes('-')) return actual === wanted;
  return actual === wanted || actual.startsWith(`${wanted}-`);
}

function documentDate(scan: InvoiceScan): string | null {
  return scan.extractedData?.issueDate ?? null;
}

function inDateRange(
  scan: InvoiceScan,
  dateFrom?: string,
  dateTo?: string,
): boolean {
  if (!dateFrom && !dateTo) return true;
  // Without an invoice date, fall back to the day it was uploaded.
  const date = documentDate(scan) ?? scan.createdAt?.toISOString().slice(0, 10);
  if (!date) return false;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

export function documentIssues(scan: InvoiceScan): InvoiceDocumentIssue[] {
  const issues: InvoiceDocumentIssue[] = [];
  if (!scan.fileKey) issues.push('no_file');
  if (scan.status === 'failed') issues.push('scan_failed');
  if (scan.status === 'needs_review' && !scan.enteredAt) issues.push('needs_review');
  if (!scan.enteredAt) issues.push('not_entered_in_quickbooks');
  if (scan.extractedData && scan.extractedData.total == null) issues.push('no_total');
  if (scan.extractedData && !scan.extractedData.issueDate) issues.push('no_date');
  return issues;
}

export function toSearchDocument(
  scan: InvoiceScan,
  scanUrl: (id: string) => string,
): InvoiceSearchDocument {
  const data = scan.extractedData;
  return {
    id: scan.id,
    url: scanUrl(scan.id),
    projectNumber: scan.projectNumber,
    fileName: scan.fileName,
    vendor: data?.counterpartyName ?? null,
    invoiceNumber: data?.invoiceNumber ?? null,
    issueDate: data?.issueDate ?? null,
    total: data?.total ?? null,
    currency: data?.currency ?? null,
    paymentStatus: data?.paymentStatus ?? 'unknown',
    status: scan.status,
    enteredInQuickbooks: !!scan.enteredAt,
    hasFile: !!scan.fileKey,
    issues: documentIssues(scan),
    locations: [],
  };
}

/** Fills each document's Drive locations from the invoice index (mutates the report's documents). */
export function attachLocations(
  report: InvoiceSearchReport,
  byScan: Map<string, InvoiceDocumentLocationSummary[]>,
): InvoiceSearchReport {
  const fill = (document: InvoiceSearchDocument) => {
    document.locations = byScan.get(document.id) ?? [];
  };
  for (const group of report.results) group.documents.forEach(fill);
  for (const item of report.missing) item.possibleUnassigned.forEach(fill);
  return report;
}

/**
 * @param projectScans every scan whose project number matches one requested
 * @param unassignedScans scans with no project number, used only to suggest
 *   candidates for a missing (project, vendor) pair
 */
export function buildSearchReport(
  input: InvoiceSearchInput,
  projectScans: InvoiceScan[],
  unassignedScans: InvoiceScan[],
  scanUrl: (id: string) => string,
): InvoiceSearchReport {
  const projects = unique(input.projects.map((value) => value.trim().toUpperCase()));
  const vendors = unique(input.vendors.map((value) => value.trim()).filter(Boolean));
  const dated = projectScans.filter((scan) =>
    inDateRange(scan, input.dateFrom, input.dateTo),
  );

  const results: InvoiceSearchGroup[] = [];
  const missing: InvoiceSearchMissing[] = [];
  const seen = new Set<string>();
  const totals: Record<string, number> = {};

  for (const project of projects) {
    const inProject = dated.filter((scan) => projectMatches(project, scan.projectNumber));
    const groups: Array<{ vendor: string | null; scans: InvoiceScan[] }> =
      vendors.length === 0
        ? [{ vendor: null, scans: inProject }]
        : vendors.map((vendor) => ({
            vendor,
            scans: inProject.filter((scan) =>
              vendorMatches(vendor, scan.extractedData?.counterpartyName ?? null, scan.fileName),
            ),
          }));

    for (const { vendor, scans } of groups) {
      const documents = scans.map((scan) => toSearchDocument(scan, scanUrl));
      results.push({ project, vendor, found: documents.length > 0, documents });
      for (const scan of scans) {
        if (seen.has(scan.id)) continue;
        seen.add(scan.id);
        const data = scan.extractedData;
        if (data?.total != null) {
          const currency = data.currency ?? 'USD';
          totals[currency] = round2((totals[currency] ?? 0) + data.total);
        }
      }
      if (vendor !== null && documents.length === 0) {
        missing.push({
          project,
          vendor,
          reason: `No document for vendor "${vendor}" is filed under project ${project}.`,
          possibleUnassigned: unassignedScans
            .filter(
              (scan) =>
                inDateRange(scan, input.dateFrom, input.dateTo) &&
                vendorMatches(vendor, scan.extractedData?.counterpartyName ?? null, scan.fileName),
            )
            .slice(0, 10)
            .map((scan) => toSearchDocument(scan, scanUrl)),
        });
      }
    }
  }

  const requestedPairs = results.length;
  return {
    query: {
      projects,
      vendors,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
    },
    summary: {
      documents: seen.size,
      requestedPairs,
      foundPairs: results.filter((group) => group.found).length,
      missingPairs: missing.length,
      totalsByCurrency: totals,
    },
    results,
    missing,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
