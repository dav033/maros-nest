import {
  QboNormalizedTransaction,
  QboRef,
} from '../core/quickbooks-normalizer.service';
import {
  PnlCategory,
  ProjectDetail,
  ProjectFinancials,
  ProjectProfitAndLoss,
  QboCustomer,
  QboEstimateResponse,
  QboInvoiceResponse,
  QboTxnBase,
} from './quickbooks-financials.types';

export function stringValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '';
}

export function deduplicateProjectNumbers(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pn of raw) {
    const trimmed = String(pn ?? '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Escapes a CRM project number before it is placed inside a regular expression.
 * Lead numbers are user data, so treating them as regex syntax would both miss
 * valid jobs and make punctuation such as `+` or `(` unsafe.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectNumberPatternPart(value: string): string {
  // QBO occasionally inserts a space around the dash (`022 -0325`) even
  // though the CRM stores the canonical `022-0325` form.
  return escapeRegExp(value).replace(/-/g, '\\s*-\\s*');
}

/**
 * QuickBooks job names are not consistent: some start with `001-0726,`, others
 * use `[001-0726]`, a dash, or simply a space before the address. Match the
 * project number as a complete token so `01-0726` cannot accidentally match
 * `101-0726`.
 */
export function matchesProjectNumber(
  projectNumber: string,
  displayName: string,
): boolean {
  const number = projectNumber.trim();
  const name = displayName.trim();
  if (!number || !name) return false;

  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${projectNumberPatternPart(number)}(?=$|[^\\p{L}\\p{N}])`,
    'iu',
  );
  return pattern.test(name);
}

/**
 * Selects the best matching QBO Customer/Job for a CRM project. A leading
 * project number wins when multiple names contain the same token; otherwise
 * the first complete-token match is safe to use.
 */
export function findQboCustomerForProject(
  projectNumber: string,
  customers: QboCustomer[],
): QboCustomer | null {
  const number = projectNumber.trim();
  if (!number) return null;

  const matches = customers.filter((customer) =>
    matchesProjectNumber(number, String(customer.DisplayName ?? '')),
  );
  if (matches.length === 0) return null;

  const escaped = projectNumberPatternPart(number);
  const leadingNumber = new RegExp(
    `^\\s*\\[?${escaped}\\]?(?=$|[\\s,|:-])`,
    'iu',
  );
  return (
    matches.find((customer) => leadingNumber.test(customer.DisplayName)) ??
    matches[0]
  );
}

/**
 * Maps a QBO job list to CRM project numbers. Longer numbers win when a job
 * contains both a base number and a change-order number (for example
 * `020P-0725` and `020P-0725 CO01`). This prevents one QBO job being linked to
 * two CRM projects.
 */
export function mapQboCustomersToProjects(
  projectNumbers: string[],
  customers: QboCustomer[],
): Map<string, QboCustomer> {
  const numbers = [
    ...new Set(projectNumbers.map((number) => number.trim()).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  const candidatesByProject = new Map<string, QboCustomer[]>();
  const result = new Map<string, QboCustomer>();

  for (const customer of customers) {
    const matchedNumber = numbers.find((number) =>
      matchesProjectNumber(number, String(customer.DisplayName ?? '')),
    );
    if (matchedNumber) {
      const candidates = candidatesByProject.get(matchedNumber) ?? [];
      candidates.push(customer);
      candidatesByProject.set(matchedNumber, candidates);
    }
  }

  for (const number of numbers) {
    const customer = findQboCustomerForProject(
      number,
      candidatesByProject.get(number) ?? [],
    );
    if (customer) result.set(number, customer);
  }

  return result;
}

export function projectRefMatches(
  ref: QboRef,
  jobId: string,
  projectNumber: string,
  jobDisplayName?: string,
): boolean {
  if (ref.value) return ref.value === jobId;
  const name = String(ref.name ?? '').trim();
  if (!name) return false;
  return (
    name === jobDisplayName ||
    name === projectNumber ||
    name.split(',')[0].trim() === projectNumber
  );
}

export function transactionMatchesProject(
  txn: QboNormalizedTransaction,
  jobId: string,
  projectNumber: string,
  jobDisplayName?: string,
): boolean {
  return txn.projectRefs.some((ref) =>
    projectRefMatches(ref, jobId, projectNumber, jobDisplayName),
  );
}

export function buildTxnQueries(
  jobIds: string[],
  includePayments: boolean,
): { estimateQuery: string; invoiceQuery: string; paymentQuery?: string } {
  const inList = jobIds
    .map((id) => `'${String(id).replace(/'/g, "''")}'`)
    .join(',');
  const where = `CustomerRef IN (${inList})`;

  return {
    estimateQuery: `SELECT * FROM Estimate WHERE ${where} STARTPOSITION 1 MAXRESULTS 1000`,
    invoiceQuery: `SELECT * FROM Invoice WHERE ${where} STARTPOSITION 1 MAXRESULTS 1000`,
    ...(includePayments && {
      paymentQuery: `SELECT * FROM Payment WHERE CustomerRef IN (${inList}) STARTPOSITION 1 MAXRESULTS 1000`,
    }),
  };
}

export function extractCustomerRefId(
  ref: QboTxnBase['CustomerRef'] | undefined,
): string {
  if (!ref) return '';
  if (typeof ref === 'object' && 'value' in ref) return String(ref.value);
  return String(ref);
}

export function indexByJobId<T extends { CustomerRef?: unknown }>(
  items: T[],
): Record<string, T[]> {
  const index: Record<string, T[]> = {};
  for (const item of items) {
    const id = extractCustomerRefId(
      item.CustomerRef as QboTxnBase['CustomerRef'],
    );
    if (!id) continue;
    if (!index[id]) index[id] = [];
    index[id].push(item);
  }
  return index;
}

export function emptyFinancials(projectNumber: string): ProjectFinancials {
  return {
    projectNumber,
    found: false,
    estimatedAmount: 0,
    estimateCount: 0,
    invoicedAmount: 0,
    invoiceCount: 0,
    paidAmount: 0,
    outstandingAmount: 0,
    paidPercentage: 0,
    estimateVsInvoicedDelta: 0,
  };
}

export function emptyDetail(projectNumber: string): ProjectDetail {
  return {
    projectNumber,
    found: false,
    job: null,
    financials: {
      estimatedAmount: 0,
      estimateCount: 0,
      invoicedAmount: 0,
      invoiceCount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      paidPercentage: 0,
      estimateVsInvoicedDelta: 0,
    },
    estimates: [],
    invoices: [],
    payments: [],
  };
}

export function aggregateFinancials(
  projectNumbers: string[],
  jobMap: Record<string, string>,
  estimatesResp: QboEstimateResponse,
  invoicesResp: QboInvoiceResponse,
): ProjectFinancials[] {
  const estimates = estimatesResp?.QueryResponse?.Estimate ?? [];
  const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];

  const estByJob: Record<string, { amount: number; count: number }> = {};
  for (const e of estimates) {
    const id = extractCustomerRefId(e.CustomerRef);
    if (!id) continue;
    if (!estByJob[id]) estByJob[id] = { amount: 0, count: 0 };
    estByJob[id].amount += Number(e.TotalAmt) || 0;
    estByJob[id].count += 1;
  }

  const invByJob: Record<
    string,
    { amount: number; count: number; outstanding: number }
  > = {};
  for (const i of invoices) {
    const id = extractCustomerRefId(i.CustomerRef);
    if (!id) continue;
    if (!invByJob[id]) invByJob[id] = { amount: 0, count: 0, outstanding: 0 };
    invByJob[id].amount += Number(i.TotalAmt) || 0;
    invByJob[id].outstanding += Number(i.Balance) || 0;
    invByJob[id].count += 1;
  }

  return projectNumbers.map((pn) => {
    const jobId = jobMap[pn];
    if (!jobId) return emptyFinancials(pn);

    const est = estByJob[jobId] ?? { amount: 0, count: 0 };
    const inv = invByJob[jobId] ?? { amount: 0, count: 0, outstanding: 0 };
    const paidAmount = inv.amount - inv.outstanding;
    const paidPercentage = inv.amount > 0 ? (paidAmount / inv.amount) * 100 : 0;

    return {
      projectNumber: pn,
      found: true,
      estimatedAmount: est.amount,
      estimateCount: est.count,
      invoicedAmount: inv.amount,
      invoiceCount: inv.count,
      paidAmount,
      outstandingAmount: inv.outstanding,
      paidPercentage: Math.round(paidPercentage * 100) / 100,
      estimateVsInvoicedDelta: est.amount - inv.amount,
    };
  });
}

export function parseProfitAndLoss(
  projectNumber: string,
  customerId: string,
  report: Record<string, unknown>,
): ProjectProfitAndLoss {
  const rows =
    ((report['Rows'] as Record<string, unknown>)?.['Row'] as Record<
      string,
      unknown
    >[]) ?? [];

  const result: ProjectProfitAndLoss = {
    projectNumber,
    found: true,
    customerId,
    income: { total: 0, categories: [] },
    costOfGoodsSold: { total: 0, categories: [] },
    expenses: { total: 0, categories: [] },
    grossProfit: 0,
    netProfit: 0,
  };

  for (const row of rows) {
    const group = stringValue(row['group']);
    const summary = row['Summary'] as Record<string, unknown>;
    const summaryData =
      (summary?.['ColData'] as Record<string, unknown>[]) ?? [];
    const totalVal = Number(summaryData[1]?.['value']) || 0;
    const innerRows =
      ((row['Rows'] as Record<string, unknown>)?.['Row'] as Record<
        string,
        unknown
      >[]) ?? [];

    const categories: PnlCategory[] = innerRows
      .filter((r) => r['type'] === 'Data')
      .map((r) => {
        const colData = (r['ColData'] as Record<string, unknown>[]) ?? [];
        return {
          name: stringValue(colData[0]?.['value']),
          amount: Number(colData[1]?.['value']) || 0,
        };
      });

    if (group === 'Income') result.income = { total: totalVal, categories };
    else if (group === 'COGS')
      result.costOfGoodsSold = { total: totalVal, categories };
    else if (group === 'Expenses')
      result.expenses = { total: totalVal, categories };
    else if (group.toLowerCase().replace(/\s/g, '') === 'netincome')
      result.netProfit = totalVal;
  }

  result.grossProfit = result.income.total - result.costOfGoodsSold.total;
  return result;
}
