import { QboReauthorizationRequiredException } from '../../quickbooks/exceptions/qbo-reauthorization-required.exception';
import {
  asRecord as qboAsRecord,
  money as qboMoney,
  normalizeName,
  nullableNumber,
  numberValue as qboNumberValue,
  trim,
} from '../../quickbooks/services/core/qbo-value.utils';
import { McpToolDeps, QboMcpPayload } from './shared';
import { resolveRealmId } from './qbo-tool-utils';

export function createQboJobCostingHelpers(deps: McpToolDeps) {
  const asRecord = (value: unknown): Record<string, unknown> => qboAsRecord(value);
  const arrayValue = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const stringValue = (value: unknown): string => trim(value);
  const numberValue = (value: unknown): number => qboNumberValue(value);
  const normalizeText = (value: unknown): string => normalizeName(value).replace(/\s+/g, ' ');
  const money = (value: number): number => qboMoney(value);
  const warningArray = (value: unknown): unknown[] => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((warning) =>
        typeof warning === 'string' ? { code: 'warning', message: warning } : warning,
      );
    }
    return [value];
  };
  const stableValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item) => stableValue(item));
    if (value instanceof Date) return value.toISOString();
    if (value !== null && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          const child = (value as Record<string, unknown>)[key];
          if (child !== undefined) acc[key] = stableValue(child);
          return acc;
        }, {});
    }
    return value;
  };
  const qboPayload = (
    summary: Record<string, unknown>,
    details: Record<string, unknown>,
    warnings: unknown,
    coverage: unknown,
  ): QboMcpPayload => ({
    summary,
    details,
    warnings: warningArray(warnings),
    coverage: asRecord(coverage),
  });
  const qboText = (payload: QboMcpPayload) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          summary: stableValue(payload.summary),
          details: stableValue(payload.details),
          warnings: stableValue(payload.warnings),
          coverage: stableValue(payload.coverage),
        }),
      },
    ],
  });
  const isQboConnectionError = (error: unknown): boolean => {
    if (error instanceof QboReauthorizationRequiredException) return true;
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('requires manual reauthorization') ||
      message.includes('QBO_REAUTHORIZATION_REQUIRED') ||
      message.includes('QuickBooks connection')
    );
  };
  const qboErrorPayload = (error: unknown): QboMcpPayload => {
    const connectionIssue = isQboConnectionError(error);
    const code = connectionIssue ? 'qbo_connection_required' : 'qbo_query_failed';
    const message = connectionIssue
      ? 'QuickBooks no está conectado o necesita autorización.'
      : 'No se pudo consultar QuickBooks con esos datos.';
    return qboPayload(
      { status: 'error', code, message },
      {
        suggestions: connectionIssue
          ? ['Conecta QuickBooks nuevamente antes de consultar información financiera.']
          : ['Revisa el proyecto, vendor, tipo de transacción o rango de fechas e intenta de nuevo.'],
      },
      [{ code, message }],
      { completed: false },
    );
  };
  const safeQboTool = async (build: () => Promise<QboMcpPayload>) => {
    try {
      return qboText(await build());
    } catch (error) {
      return qboText(qboErrorPayload(error));
    }
  };
  const toJobCostParams = (params: Record<string, unknown>): Record<string, unknown> => ({
    ...params,
    includeAttachments: params.includeAttachments !== false,
    includeAttachmentDownloadUrls: false,
    includeRaw: params.includeRaw === true,
  });
  const resolveQboRealmId = async (realmId?: string): Promise<string> =>
    resolveRealmId(deps, realmId);
  const qboProjectFound = (project: unknown): boolean => {
    const p = asRecord(project);
    if (p.foundInQuickBooks === true || p.found === true) return true;
    if (stringValue(p.qboCustomerId)) return true;
    return arrayValue(p.refs).some((ref) => stringValue(asRecord(ref).value));
  };
  const projectCustomerId = (project: unknown): string | undefined => {
    const p = asRecord(project);
    const id = stringValue(p.qboCustomerId);
    if (id) return id;
    const ref = arrayValue(p.refs).map((item) => asRecord(item)).find((item) => stringValue(item.value));
    return ref ? stringValue(ref.value) : undefined;
  };
  const projectLabel = (project: unknown, fallback: { projectNumber?: string; qboCustomerId?: string }) => {
    const p = asRecord(project);
    return {
      projectNumber: p.projectNumber ?? fallback.projectNumber ?? null,
      qboCustomerId: p.qboCustomerId ?? fallback.qboCustomerId ?? projectCustomerId(project) ?? null,
      displayName: p.displayName ?? p.customerName ?? null,
    };
  };
  const emptyJobSummary = (): Record<string, number> => ({ cashOutPaid: 0, openAp: 0, committedPo: 0, vendorCredits: 0, adjustedCosts: 0, totalJobCost: 0 });
  const addTransactionToSummary = (summary: Record<string, unknown>, txn: Record<string, unknown>): void => {
    const amount = numberValue(txn.allocatedAmount);
    switch (txn.classification) {
      case 'cash_out_paid':
        summary.cashOutPaid = money(numberValue(summary.cashOutPaid) + amount);
        break;
      case 'open_ap':
        summary.openAp = money(numberValue(summary.openAp) + amount);
        break;
      case 'commitment':
        summary.committedPo = money(numberValue(summary.committedPo) + amount);
        break;
      case 'credit':
        summary.vendorCredits = money(numberValue(summary.vendorCredits) + amount);
        break;
      case 'adjustment':
        summary.adjustedCosts = money(numberValue(summary.adjustedCosts) + amount);
        break;
      default:
        break;
    }
    summary.totalJobCost = money(
      numberValue(summary.cashOutPaid) + numberValue(summary.openAp) + numberValue(summary.committedPo) + numberValue(summary.adjustedCosts) - numberValue(summary.vendorCredits),
    );
  };
  const groupTransactionsByClassification = (transactions: unknown[]): Record<string, unknown[]> =>
    transactions.reduce<Record<string, unknown[]>>((acc, txn) => {
      const key = stringValue(asRecord(txn).classification) || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(txn);
      return acc;
    }, {});
  const groupTransactionsByVendor = (transactions: unknown[]): Record<string, unknown> =>
    transactions.reduce<Record<string, unknown>>((acc, txn) => {
      const t = asRecord(txn);
      const vendor = asRecord(t.vendor);
      const vendorId = stringValue(vendor.value) || 'unknown';
      const vendorName = stringValue(vendor.name) || vendorId;
      if (!acc[vendorId]) acc[vendorId] = { vendorId, vendorName, transactions: [], summary: emptyJobSummary() };
      arrayValue(asRecord(acc[vendorId]).transactions).push(txn);
      addTransactionToSummary(asRecord(asRecord(acc[vendorId]).summary), t);
      return acc;
    }, {});
  const buildApAging = (openBills: unknown[]): Record<string, unknown> => {
    const buckets = { current: { items: [], count: 0, totalBalance: 0 }, days1to30: { items: [], count: 0, totalBalance: 0 }, days31to60: { items: [], count: 0, totalBalance: 0 }, days61to90: { items: [], count: 0, totalBalance: 0 }, over90: { items: [], count: 0, totalBalance: 0 } };
    const today = new Date();
    for (const bill of openBills) {
      const b = asRecord(bill);
      const dueDate = stringValue(b.dueDate);
      const daysOverdue = dueDate ? Math.floor((today.getTime() - new Date(dueDate).getTime()) / 86400000) : 0;
      const balance = numberValue(b.openBalance ?? b.allocatedAmount);
      const item = { entityType: b.entityType, entityId: b.entityId, docNumber: b.docNumber, vendor: b.vendor, dueDate: dueDate || null, balance, daysOverdue: Math.max(0, daysOverdue) };
      const bucket = daysOverdue <= 0 ? buckets.current : daysOverdue <= 30 ? buckets.days1to30 : daysOverdue <= 60 ? buckets.days31to60 : daysOverdue <= 90 ? buckets.days61to90 : buckets.over90;
      (bucket.items as unknown[]).push(item);
      bucket.count += 1;
      bucket.totalBalance = money(bucket.totalBalance + balance);
    }
    return buckets;
  };
  const summarizeJobTransactions = (transactions: unknown[]): Record<string, number> => {
    const summary = emptyJobSummary();
    for (const txn of transactions) addTransactionToSummary(summary, asRecord(txn));
    summary.totalJobCost = money(summary.cashOutPaid + summary.openAp + summary.committedPo + summary.adjustedCosts - summary.vendorCredits);
    return summary;
  };
  const filterTransactionsByTypes = (transactions: unknown[], transactionTypes?: string[]): unknown[] => {
    if (!transactionTypes?.length) return transactions;
    const allowed = new Set(transactionTypes);
    return transactions.filter((txn) => allowed.has(stringValue(asRecord(txn).entityType)));
  };
  const tryRead = async <T>(read: () => Promise<T>, warnings: unknown[], code: string, message: string): Promise<T | null> => {
    try {
      return await read();
    } catch {
      warnings.push({ code, message });
      return null;
    }
  };
  const projectNotFoundPayload = (params: { projectNumber?: string; qboCustomerId?: string }): QboMcpPayload =>
    qboPayload(
      { status: 'notFound', message: 'No encontré ese proyecto en QuickBooks.', projectNumber: params.projectNumber ?? null, qboCustomerId: params.qboCustomerId ?? null },
      { suggestions: ['Busca el proyecto por número exacto.', 'Si lo tienes, usa el qboCustomerId del job en QuickBooks.', 'Revisa que el proyecto exista como Customer/Job en QuickBooks.'] },
      [{ code: 'project_not_found', message: 'No encontré ese proyecto en QuickBooks.' }],
      { completed: true, notFound: true },
    );
  const vendorNotFoundPayload = (params: { vendorId?: string; vendorName?: string }, suggestions: unknown[]): QboMcpPayload =>
    qboPayload(
      { status: 'notFound', message: 'No encontré ese vendor en QuickBooks.', vendorId: params.vendorId ?? null, vendorName: params.vendorName ?? null },
      { suggestions },
      [{ code: 'vendor_not_found', message: 'No encontré ese vendor en QuickBooks.' }],
      { completed: true, notFound: true },
    );
  const transactionNotFoundPayload = (params: { entityType: string; entityId: string }): QboMcpPayload =>
    qboPayload(
      { status: 'notFound', message: 'No encontré esa transacción en QuickBooks.', entityType: params.entityType, entityId: params.entityId },
      { suggestions: ['Revisa el tipo de transacción.', 'Confirma que el ID corresponde a esa entidad en QuickBooks.'] },
      [{ code: 'transaction_not_found', message: 'No encontré esa transacción en QuickBooks.' }],
      { completed: true, notFound: true },
    );
  const findVendorForTool = async (realmId: string, vendorId?: string, vendorName?: string): Promise<{ found: boolean; suggestions: unknown[] } | null> => {
    if (!vendorId && !vendorName) return null;
    const vendors = await deps.qboVendorMatching.listQboVendors(realmId);
    const normalizedName = normalizeText(vendorName);
    const found = vendors.some((vendor) => (vendorId && vendor.vendorId === vendorId) || (!!normalizedName && (normalizeText(vendor.displayName) === normalizedName || normalizeText(vendor.displayName).includes(normalizedName))));
    const suggestions = vendors.filter((vendor) => !normalizedName || normalizeText(vendor.displayName).includes(normalizedName)).slice(0, 5).map((vendor) => ({ vendorId: vendor.vendorId, vendorName: vendor.displayName, email: vendor.email ?? null, phone: vendor.phone ?? null }));
    return { found, suggestions };
  };
  const normalizeQboTransaction = (entityType: string, raw: Record<string, unknown>): unknown => {
    switch (entityType) {
      case 'Invoice': return deps.qboNormalizer.normalizeInvoice(raw);
      case 'Estimate': return deps.qboNormalizer.normalizeEstimate(raw);
      case 'Payment': return deps.qboNormalizer.normalizePayment(raw);
      case 'Purchase': return deps.qboNormalizer.normalizePurchase(raw);
      case 'Bill': return deps.qboNormalizer.normalizeBill(raw);
      case 'BillPayment': return deps.qboNormalizer.normalizeBillPayment(raw);
      case 'VendorCredit': return deps.qboNormalizer.normalizeVendorCredit(raw);
      case 'PurchaseOrder': return deps.qboNormalizer.normalizePurchaseOrder(raw);
      case 'JournalEntry': return deps.qboNormalizer.normalizeJournalEntry(raw);
      default: return raw;
    }
  };
  const getOptionalProjectReportBundle = async (params: { realmId?: string; startDate?: string; endDate?: string; includeRaw?: boolean }, customerId: string | undefined, warnings: unknown[]): Promise<unknown> => {
    if (!params.startDate || !params.endDate || !customerId) {
      warnings.push({ code: 'reports_not_included', message: 'Para incluir reportes financieros envía startDate, endDate y un proyecto encontrado.' });
      return null;
    }
    return tryRead(
      () => deps.qboReports.getProjectReportBundle({ realmId: params.realmId, startDate: params.startDate!, endDate: params.endDate!, customerId, includeRaw: params.includeRaw }),
      warnings,
      'project_reports_unavailable',
      'No se pudieron traer los reportes financieros del proyecto.',
    );
  };

  const buildProjectJobCostSummaryPayload = async (params: { projectNumber?: string; qboCustomerId?: string; realmId?: string; startDate?: string; endDate?: string; includeAttachments?: boolean; includeReports?: boolean; includeRaw?: boolean; }): Promise<QboMcpPayload> => {
    const jobCost = await deps.qboJobCosting.getProjectJobCostSummary(toJobCostParams(params));
    if (!qboProjectFound(jobCost.project)) return projectNotFoundPayload(params);
    const warnings = [...warningArray(jobCost.warnings)];
    const profile = params.projectNumber
      ? await tryRead(() => deps.qboFinancials.getProjectFullProfile(params.projectNumber!, params.realmId), warnings, 'project_profile_unavailable', 'No se pudo traer el detalle completo del proyecto.')
      : null;
    const reportBundle = params.includeReports !== false ? await getOptionalProjectReportBundle(params, projectCustomerId(jobCost.project), warnings) : null;
    const profileRecord = asRecord(profile);
    const financials = asRecord(profileRecord.financials);
    const jobSummary = asRecord(jobCost.summary);
    return qboPayload(
      {
        status: 'ok',
        project: projectLabel(jobCost.project, params),
        contractAmount: nullableNumber(financials.estimatedAmount),
        invoicedAmount: nullableNumber(financials.invoicedAmount),
        paidAmount: nullableNumber(financials.paidAmount),
        outstandingAmount: nullableNumber(financials.outstandingAmount),
        cashOutPaid: jobSummary.cashOutPaid ?? 0,
        openAp: jobSummary.openAp ?? 0,
        committedPo: jobSummary.committedPo ?? 0,
        vendorCredits: jobSummary.vendorCredits ?? 0,
        totalJobCost: jobSummary.totalJobCost ?? 0,
        estimatedProfit: money(numberValue(financials.estimatedAmount) - numberValue(jobSummary.totalJobCost)),
        vendorCount: jobCost.vendorBreakdown.length,
      },
      {
        project: jobCost.project,
        contract: profile
          ? { financials: profileRecord.financials, estimates: profileRecord.estimates, invoices: profileRecord.invoices, payments: profileRecord.payments, attachments: params.includeAttachments === false ? [] : profileRecord.attachments }
          : null,
        jobCost: { summary: jobCost.summary, vendorBreakdown: jobCost.vendorBreakdown, categoryBreakdown: jobCost.categoryBreakdown },
        reports: reportBundle,
      },
      warnings,
      { ...asRecord(jobCost.coverage), profileIncluded: profile !== null, reportsIncluded: reportBundle !== null },
    );
  };
  const buildProjectCashOutPayload = async (params: { projectNumber?: string; qboCustomerId?: string; realmId?: string; startDate?: string; endDate?: string; includeAttachments?: boolean; includeRaw?: boolean; }): Promise<QboMcpPayload> => {
    const result = await deps.qboJobCosting.getProjectCashOut(toJobCostParams(params));
    if (!qboProjectFound(result.project)) return projectNotFoundPayload(params);
    return qboPayload(
      { status: 'ok', project: projectLabel(result.project, params), ...asRecord(result.summary), transactionCount: result.transactions.length, vendorCount: result.vendorBreakdown.length },
      { project: result.project, byStatus: groupTransactionsByClassification(result.transactions), transactions: result.transactions, vendorBreakdown: result.vendorBreakdown, categoryBreakdown: result.categoryBreakdown },
      result.warnings,
      result.coverage,
    );
  };
  const buildProjectApStatusPayload = async (params: { projectNumber?: string; qboCustomerId?: string; realmId?: string; startDate?: string; endDate?: string; includeAttachments?: boolean; includeRaw?: boolean; }): Promise<QboMcpPayload> => {
    const result = await deps.qboJobCosting.getProjectApStatus(toJobCostParams(params));
    if (!qboProjectFound(result.project)) return projectNotFoundPayload(params);
    return qboPayload(
      { status: 'ok', project: projectLabel(result.project, params), openAp: result.summary.openAp, vendorCredits: result.summary.vendorCredits, openBillCount: result.openBills.length, vendorCount: result.vendorBreakdown.length },
      { project: result.project, aging: buildApAging(result.openBills), openBills: result.openBills, billPayments: result.billPayments, vendorCredits: result.vendorCredits, vendorBreakdown: result.vendorBreakdown },
      result.warnings,
      result.coverage,
    );
  };
  const buildProjectVendorTransactionsPayload = async (params: { projectNumber?: string; qboCustomerId?: string; vendorId?: string; vendorName?: string; realmId?: string; startDate?: string; endDate?: string; includeAttachments?: boolean; includeRaw?: boolean; }): Promise<QboMcpPayload> => {
    const realmId = await resolveQboRealmId(params.realmId);
    const vendorCheck = await findVendorForTool(realmId, params.vendorId, params.vendorName);
    if (vendorCheck && !vendorCheck.found) return vendorNotFoundPayload(params, vendorCheck.suggestions);
    const result = await deps.qboJobCosting.getProjectVendorTransactions(toJobCostParams({ ...params, realmId }));
    if (!qboProjectFound(result.project)) return projectNotFoundPayload(params);
    return qboPayload(
      { status: 'ok', project: projectLabel(result.project, params), transactionCount: result.transactions.length, vendorCount: result.vendorBreakdown.length },
      { project: result.project, byVendor: groupTransactionsByVendor(result.transactions), transactions: result.transactions, vendorBreakdown: result.vendorBreakdown },
      result.warnings,
      result.coverage,
    );
  };
  const buildVendorTransactionsPayload = async (params: { vendorId?: string; vendorName?: string; projectNumber?: string; qboCustomerId?: string; startDate?: string; endDate?: string; transactionTypes?: string[]; includeAttachments?: boolean; includeRaw?: boolean; realmId?: string; }): Promise<QboMcpPayload> => {
    const realmId = await resolveQboRealmId(params.realmId);
    const vendorCheck = await findVendorForTool(realmId, params.vendorId, params.vendorName);
    if (vendorCheck && !vendorCheck.found) return vendorNotFoundPayload(params, vendorCheck.suggestions);
    const result = await deps.qboJobCosting.getVendorTransactions(toJobCostParams({ ...params, realmId }));
    if ((params.projectNumber || params.qboCustomerId) && result.project && !qboProjectFound(result.project)) return projectNotFoundPayload(params);
    const transactions = filterTransactionsByTypes(arrayValue(result.transactions), params.transactionTypes);
    return qboPayload(
      { status: 'ok', vendorId: params.vendorId ?? null, vendorName: params.vendorName ?? null, project: result.project !== undefined ? projectLabel(result.project, params) : null, transactionCount: transactions.length, ...summarizeJobTransactions(transactions) },
      { vendorFilter: result.vendorFilter, project: result.project ?? null, transactions, byStatus: groupTransactionsByClassification(transactions), categoryBreakdown: result.categoryBreakdown },
      result.warnings,
      { ...asRecord(result.coverage), transactionTypes: params.transactionTypes ?? null },
    );
  };
  const buildTransactionAttachmentsPayload = async (params: { entityType: string; entityId: string; realmId?: string; includeDownloadUrl?: boolean; }): Promise<QboMcpPayload> => {
    const realmId = await resolveQboRealmId(params.realmId);
    const result = await deps.qboAttachments.getAttachmentsForEntity(realmId, params.entityType, params.entityId, { includeTempDownloadUrl: params.includeDownloadUrl === true });
    return qboPayload(
      { status: 'ok', entityType: params.entityType, entityId: params.entityId, attachmentCount: result.attachments.length },
      { entityRef: result.entityRef, attachments: result.attachments },
      result.warnings,
      { entitiesChecked: 1, attachmentsFound: result.attachments.length, fallbackUsed: result.fallbackUsed, downloadUrlsIncluded: params.includeDownloadUrl === true },
    );
  };
  const buildTransactionByIdPayload = async (params: { entityType: string; entityId: string; realmId?: string; includeAttachments?: boolean; includeRaw?: boolean; }): Promise<QboMcpPayload> => {
    const realmId = await resolveQboRealmId(params.realmId);
    const rawResponse = await deps.qboApi.getById(realmId, params.entityType, params.entityId);
    const raw = deps.qboApi.unwrapQboEntity(rawResponse, params.entityType);
    if (!Object.keys(raw).length) return transactionNotFoundPayload(params);
    const transaction = normalizeQboTransaction(params.entityType, raw);
    const attachments =
      params.includeAttachments === false
        ? null
        : await deps.qboAttachments.getAttachmentsForEntity(realmId, params.entityType, params.entityId);
    return qboPayload(
      { status: 'ok', entityType: params.entityType, entityId: params.entityId, transactionDate: asRecord(transaction).txnDate ?? null, totalAmount: asRecord(transaction).totalAmount ?? null, attachmentCount: attachments?.attachments.length ?? 0 },
      { transaction, attachments: attachments?.attachments ?? [], ...(params.includeRaw === true && { raw }) },
      [...warningArray(asRecord(transaction).warnings), ...warningArray(attachments?.warnings)],
      { entityType: params.entityType, entityId: params.entityId, attachmentsRequested: params.includeAttachments !== false, attachmentsFound: attachments?.attachments.length ?? 0, fallbackUsed: attachments?.fallbackUsed ?? false },
    );
  };
  const buildProjectReportBundlePayload = async (params: { projectNumber?: string; qboCustomerId?: string; startDate: string; endDate: string; accountingMethod?: 'Cash' | 'Accrual'; includeRaw?: boolean; realmId?: string; }): Promise<QboMcpPayload> => {
    const realmId = await resolveQboRealmId(params.realmId);
    const project = await deps.qboJobCosting.findProjectRefs({ realmId, projectNumber: params.projectNumber, qboCustomerId: params.qboCustomerId });
    if (!qboProjectFound(project)) return projectNotFoundPayload(params);
    const customerId = params.qboCustomerId ?? projectCustomerId(project);
    const reports = await deps.qboReports.getProjectReportBundle({ realmId, startDate: params.startDate, endDate: params.endDate, customerId, accountingMethod: params.accountingMethod, includeRaw: params.includeRaw });
    return qboPayload(
      { status: 'ok', project: projectLabel(project, params), customerId: customerId ?? null, profitAndLossRows: reports.profitAndLoss.rows.length, profitAndLossDetailRows: reports.profitAndLossDetail.rows.length, vendorExpenseRows: reports.vendorExpenses.rows.length, agedPayableRows: reports.agedPayables.rows.length, vendorBalanceDetailRows: reports.vendorBalanceDetail.rows.length },
      { project, reports: { profitAndLoss: reports.profitAndLoss, profitAndLossDetail: reports.profitAndLossDetail, vendorExpenses: reports.vendorExpenses, agedPayables: reports.agedPayables, vendorBalanceDetail: reports.vendorBalanceDetail } },
      reports.warnings.map((message) => ({ code: 'report_warning', message })),
      reports.coverage,
    );
  };

  return {
    safeQboTool,
    buildProjectJobCostSummaryPayload,
    buildProjectCashOutPayload,
    buildProjectApStatusPayload,
    buildProjectVendorTransactionsPayload,
    buildVendorTransactionsPayload,
    buildTransactionAttachmentsPayload,
    buildTransactionByIdPayload,
    buildProjectReportBundlePayload,
  };
}
