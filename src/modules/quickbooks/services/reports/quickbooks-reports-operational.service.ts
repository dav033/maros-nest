import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksReportsContextService } from './quickbooks-reports.context.service';
import {
  AgingBucket,
  AgingInvoiceItem,
  AgingReport,
  BacklogItem,
  ClientRevenueItem,
  FinancialSearchCriteria,
  FinancialSearchResult,
  JobIndex,
  OutstandingBalanceItem,
  QboEstimateResponse,
  QboInvoiceResponse,
  QboPaymentResponse,
  RevenueByPeriodResult,
} from './quickbooks-reports.types';

@Injectable()
export class QuickbooksReportsOperationalService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly contextService: QuickbooksReportsContextService,
  ) {}

  async getAgingReport(realmId?: string): Promise<AgingReport> {
    const rid = await this.contextService.resolveRealmId(realmId);
    const [jobIndex, invoicesResp] = await Promise.all([
      this.contextService.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets: AgingReport = {
      asOf: today.toISOString().split('T')[0],
      current: { invoices: [], totalBalance: 0, count: 0 },
      days1to30: { invoices: [], totalBalance: 0, count: 0 },
      days31to60: { invoices: [], totalBalance: 0, count: 0 },
      days61to90: { invoices: [], totalBalance: 0, count: 0 },
      over90: { invoices: [], totalBalance: 0, count: 0 },
      totalOutstanding: 0,
    };

    for (const inv of invoices) {
      const balance = Number(inv.Balance) || 0;
      if (!balance) continue;

      const jobId = this.contextService.refId(inv.CustomerRef);
      const dueStr = inv.DueDate ?? inv.TxnDate ?? '';
      const dueDate = dueStr ? new Date(dueStr) : null;
      const daysOverdue = dueDate
        ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000)
        : 0;

      const item: AgingInvoiceItem = {
        invoiceId: String(inv.Id),
        invoiceNumber: String(inv.DocNumber ?? ''),
        customerName: this.contextService.refName(inv.CustomerRef),
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        txnDate: String(inv.TxnDate ?? ''),
        dueDate: String(inv.DueDate ?? ''),
        totalAmount: Number(inv.TotalAmt) || 0,
        balance,
        daysOverdue: Math.max(0, daysOverdue),
      };

      const bucket = this.resolveAgingBucket(buckets, daysOverdue);
      bucket.invoices.push(item);
      bucket.totalBalance += balance;
      bucket.count += 1;
      buckets.totalOutstanding += balance;
    }

    return buckets;
  }

  async getOutstandingBalances(realmId?: string): Promise<OutstandingBalanceItem[]> {
    const rid = await this.contextService.resolveRealmId(realmId);
    const [jobIndex, invoicesResp] = await Promise.all([
      this.contextService.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
    const byJob: Record<string, { totalInvoiced: number; outstanding: number; count: number; oldest: string | null }> = {};

    for (const inv of invoices) {
      const jobId = this.contextService.refId(inv.CustomerRef);
      if (!jobId) continue;
      if (!byJob[jobId]) byJob[jobId] = { totalInvoiced: 0, outstanding: 0, count: 0, oldest: null };
      byJob[jobId].totalInvoiced += Number(inv.TotalAmt) || 0;
      byJob[jobId].outstanding += Number(inv.Balance) || 0;
      byJob[jobId].count += 1;
      const txnDate = inv.TxnDate ?? null;
      if (txnDate && (!byJob[jobId].oldest || txnDate < byJob[jobId].oldest)) {
        byJob[jobId].oldest = txnDate;
      }
    }

    return Object.entries(byJob)
      .map(([jobId, agg]) => ({
        jobId,
        customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        totalInvoiced: agg.totalInvoiced,
        totalOutstanding: agg.outstanding,
        invoiceCount: agg.count,
        oldestInvoiceDate: agg.oldest,
      }))
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  async getRevenueByPeriod(
    start: string,
    end: string,
    realmId?: string,
  ): Promise<RevenueByPeriodResult> {
    const rid = await this.contextService.resolveRealmId(realmId);
    const resp = (await this.apiService.query(
      rid,
      `SELECT * FROM Payment WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION 1 MAXRESULTS 1000`,
    )) as QboPaymentResponse;

    const payments = resp?.QueryResponse?.Payment ?? [];
    const totalRevenue = payments.reduce(
      (sum, payment) => sum + (Number(payment['TotalAmt']) || 0),
      0,
    );

    return { period: { start, end }, totalRevenue, paymentCount: payments.length, payments };
  }

  async getBacklog(realmId?: string): Promise<BacklogItem[]> {
    const rid = await this.contextService.resolveRealmId(realmId);
    const [jobIndex, estResp, invResp] = await Promise.all([
      this.contextService.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Estimate STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboEstimateResponse>,
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const estimates = estResp?.QueryResponse?.Estimate ?? [];
    const invoices = invResp?.QueryResponse?.Invoice ?? [];
    const estByJob: Record<string, { amount: number; count: number }> = {};
    const invByJob: Record<string, { amount: number; count: number }> = {};

    for (const estimate of estimates) {
      const id = this.contextService.refId(estimate.CustomerRef);
      if (!id) continue;
      if (!estByJob[id]) estByJob[id] = { amount: 0, count: 0 };
      estByJob[id].amount += Number(estimate.TotalAmt) || 0;
      estByJob[id].count += 1;
    }

    for (const invoice of invoices) {
      const id = this.contextService.refId(invoice.CustomerRef);
      if (!id) continue;
      if (!invByJob[id]) invByJob[id] = { amount: 0, count: 0 };
      invByJob[id].amount += Number(invoice.TotalAmt) || 0;
      invByJob[id].count += 1;
    }

    const allJobIds = new Set([...Object.keys(estByJob), ...Object.keys(invByJob)]);
    return [...allJobIds]
      .map((jobId) => this.buildBacklogItem(jobId, estByJob, invByJob, jobIndex))
      .filter((item) => item.backlogAmount > 0)
      .sort((a, b) => b.backlogAmount - a.backlogAmount);
  }

  async searchByFinancialCriteria(
    criteria: FinancialSearchCriteria,
    realmId?: string,
  ): Promise<FinancialSearchResult[]> {
    const rid = await this.contextService.resolveRealmId(realmId);
    const [jobIndex, estResp, invResp] = await Promise.all([
      this.contextService.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Estimate STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboEstimateResponse>,
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const estByJob: Record<string, number> = {};
    for (const estimate of estResp?.QueryResponse?.Estimate ?? []) {
      const id = this.contextService.refId(estimate.CustomerRef);
      if (!id) continue;
      estByJob[id] = (estByJob[id] ?? 0) + (Number(estimate.TotalAmt) || 0);
    }

    const invByJob: Record<string, { invoiced: number; outstanding: number }> = {};
    for (const invoice of invResp?.QueryResponse?.Invoice ?? []) {
      const id = this.contextService.refId(invoice.CustomerRef);
      if (!id) continue;
      if (!invByJob[id]) invByJob[id] = { invoiced: 0, outstanding: 0 };
      invByJob[id].invoiced += Number(invoice.TotalAmt) || 0;
      invByJob[id].outstanding += Number(invoice.Balance) || 0;
    }

    const allJobIds = new Set([...Object.keys(estByJob), ...Object.keys(invByJob)]);
    const results: FinancialSearchResult[] = [];

    for (const jobId of allJobIds) {
      const estimated = estByJob[jobId] ?? 0;
      const invoiceData = invByJob[jobId] ?? { invoiced: 0, outstanding: 0 };
      const unbilled = estimated - invoiceData.invoiced;
      if (!this.matchesFinancialCriteria(criteria, estimated, invoiceData, unbilled)) {
        continue;
      }
      results.push({
        jobId,
        customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        estimatedAmount: estimated,
        invoicedAmount: invoiceData.invoiced,
        outstandingBalance: invoiceData.outstanding,
        unbilledAmount: unbilled,
      });
    }

    return results.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  }

  async getTopClientsByRevenue(
    limit: number = 10,
    realmId?: string,
  ): Promise<ClientRevenueItem[]> {
    const rid = await this.contextService.resolveRealmId(realmId);
    const [jobIndex, invoicesResp] = await Promise.all([
      this.contextService.buildJobIndex(rid),
      this.apiService.query(
        rid,
        `SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1000`,
      ) as Promise<QboInvoiceResponse>,
    ]);

    const byJob: Record<string, { totalInvoiced: number; outstanding: number; count: number }> = {};
    for (const invoice of invoicesResp?.QueryResponse?.Invoice ?? []) {
      const jobId = this.contextService.refId(invoice.CustomerRef);
      if (!jobId) continue;
      if (!byJob[jobId]) byJob[jobId] = { totalInvoiced: 0, outstanding: 0, count: 0 };
      byJob[jobId].totalInvoiced += Number(invoice.TotalAmt) || 0;
      byJob[jobId].outstanding += Number(invoice.Balance) || 0;
      byJob[jobId].count += 1;
    }

    return Object.entries(byJob)
      .map(([jobId, agg]) => ({
        jobId,
        customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
        projectNumber: jobIndex.projectNumberById[jobId] ?? null,
        totalInvoiced: agg.totalInvoiced,
        totalPaid: agg.totalInvoiced - agg.outstanding,
        totalOutstanding: agg.outstanding,
        invoiceCount: agg.count,
      }))
      .sort((a, b) => b.totalInvoiced - a.totalInvoiced)
      .slice(0, limit);
  }

  private resolveAgingBucket(report: AgingReport, daysOverdue: number): AgingBucket {
    if (daysOverdue <= 0) return report.current;
    if (daysOverdue <= 30) return report.days1to30;
    if (daysOverdue <= 60) return report.days31to60;
    if (daysOverdue <= 90) return report.days61to90;
    return report.over90;
  }

  private buildBacklogItem(
    jobId: string,
    estByJob: Record<string, { amount: number; count: number }>,
    invByJob: Record<string, { amount: number; count: number }>,
    jobIndex: JobIndex,
  ): BacklogItem {
    const estimated = estByJob[jobId] ?? { amount: 0, count: 0 };
    const invoiced = invByJob[jobId] ?? { amount: 0, count: 0 };
    return {
      jobId,
      customerName: jobIndex.byId[jobId]?.DisplayName ?? jobId,
      projectNumber: jobIndex.projectNumberById[jobId] ?? null,
      estimatedAmount: estimated.amount,
      invoicedAmount: invoiced.amount,
      backlogAmount: estimated.amount - invoiced.amount,
      estimateCount: estimated.count,
      invoiceCount: invoiced.count,
    };
  }

  private matchesFinancialCriteria(
    criteria: FinancialSearchCriteria,
    estimated: number,
    invoiceData: { invoiced: number; outstanding: number },
    unbilled: number,
  ): boolean {
    if (
      criteria.minOutstanding !== undefined &&
      invoiceData.outstanding < criteria.minOutstanding
    ) {
      return false;
    }
    if (
      criteria.maxOutstanding !== undefined &&
      invoiceData.outstanding > criteria.maxOutstanding
    ) {
      return false;
    }
    if (criteria.minInvoiced !== undefined && invoiceData.invoiced < criteria.minInvoiced) {
      return false;
    }
    if (criteria.maxInvoiced !== undefined && invoiceData.invoiced > criteria.maxInvoiced) {
      return false;
    }
    if (criteria.minEstimated !== undefined && estimated < criteria.minEstimated) {
      return false;
    }
    if (criteria.hasUnbilledWork === true && unbilled <= 0) {
      return false;
    }
    if (criteria.minUnbilledAmount !== undefined && unbilled < criteria.minUnbilledAmount) {
      return false;
    }
    return true;
  }
}

