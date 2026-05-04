import { QboAiWarning } from '../core/quickbooks-normalizer.service';
import {
  QboJobCostBreakdown,
  QboJobCostSummary,
  QboJobCostTransaction,
  QboVendorCrmEntry,
} from './quickbooks-job-costing.types';

export type BreakdownContext = {
  money(value: number): number;
  firstLineCategory(txn: QboJobCostTransaction): { name?: string; value?: string } | undefined;
  normalizeName(value: string): string;
  normalizer: { warning(code: string, message: string): QboAiWarning };
  vendorMatching: {
    getVendorCrmMap(realmId: string): Promise<{
      entries: QboVendorCrmEntry[];
      byVendorId: Record<string, QboVendorCrmEntry>;
    }>;
  };
  enrichVendorBreakdownBucket(
    bucket: QboJobCostBreakdown,
    match: QboVendorCrmEntry,
  ): QboJobCostBreakdown;
};

export function summarizeEngine(
  ctx: BreakdownContext,
  transactions: QboJobCostTransaction[],
): QboJobCostSummary {
  const summary: QboJobCostSummary = {
    cashOutPaid: 0,
    openAp: 0,
    committedPo: 0,
    vendorCredits: 0,
    adjustedCosts: 0,
    totalJobCost: 0,
  };

  for (const txn of transactions) {
    switch (txn.classification) {
      case 'cash_out_paid':
        summary.cashOutPaid += txn.allocatedAmount;
        break;
      case 'open_ap':
        summary.openAp += txn.allocatedAmount;
        break;
      case 'commitment':
        summary.committedPo += txn.allocatedAmount;
        break;
      case 'credit':
        summary.vendorCredits += txn.allocatedAmount;
        break;
      case 'adjustment':
        summary.adjustedCosts += txn.allocatedAmount;
        break;
    }
  }

  summary.cashOutPaid = ctx.money(summary.cashOutPaid);
  summary.openAp = ctx.money(summary.openAp);
  summary.committedPo = ctx.money(summary.committedPo);
  summary.vendorCredits = ctx.money(summary.vendorCredits);
  summary.adjustedCosts = ctx.money(summary.adjustedCosts);
  summary.totalJobCost = ctx.money(
    summary.cashOutPaid +
      summary.openAp +
      summary.adjustedCosts -
      summary.vendorCredits,
  );

  return summary;
}

export function buildBreakdownEngine(
  ctx: BreakdownContext,
  transactions: QboJobCostTransaction[],
  by: 'vendor' | 'category',
): QboJobCostBreakdown[] {
  const buckets = new Map<string, QboJobCostBreakdown>();

  for (const txn of transactions) {
    const ref =
      by === 'vendor' ? txn.vendor : txn.category ?? txn.account ?? ctx.firstLineCategory(txn);
    const name = ref?.name || ref?.value || 'Uncategorized';
    const id = ref?.value || undefined;
    const key = `${id ?? ''}:${name}`;
    const bucket =
      buckets.get(key) ??
      ({
        ...(id && { id }),
        name,
        cashOutPaid: 0,
        openAp: 0,
        committedPo: 0,
        vendorCredits: 0,
        adjustedCosts: 0,
        totalJobCost: 0,
        transactionCount: 0,
      } satisfies QboJobCostBreakdown);

    switch (txn.classification) {
      case 'cash_out_paid':
        bucket.cashOutPaid += txn.allocatedAmount;
        break;
      case 'open_ap':
        bucket.openAp += txn.allocatedAmount;
        break;
      case 'commitment':
        bucket.committedPo += txn.allocatedAmount;
        break;
      case 'credit':
        bucket.vendorCredits += txn.allocatedAmount;
        break;
      case 'adjustment':
        bucket.adjustedCosts += txn.allocatedAmount;
        break;
    }
    bucket.transactionCount += 1;
    bucket.totalJobCost =
      bucket.cashOutPaid +
      bucket.openAp +
      bucket.committedPo +
      bucket.adjustedCosts -
      bucket.vendorCredits;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      cashOutPaid: ctx.money(bucket.cashOutPaid),
      openAp: ctx.money(bucket.openAp),
      committedPo: ctx.money(bucket.committedPo),
      vendorCredits: ctx.money(bucket.vendorCredits),
      adjustedCosts: ctx.money(bucket.adjustedCosts),
      totalJobCost: ctx.money(bucket.totalJobCost),
    }))
    .sort((a, b) => Math.abs(b.totalJobCost) - Math.abs(a.totalJobCost));
}

export async function buildVendorBreakdownEngine(
  ctx: BreakdownContext,
  realmId: string,
  transactions: QboJobCostTransaction[],
): Promise<{ breakdown: QboJobCostBreakdown[]; warnings: QboAiWarning[] }> {
  const breakdown = buildBreakdownEngine(ctx, transactions, 'vendor');
  if (!breakdown.length) return { breakdown, warnings: [] };

  try {
    const crmMap = await ctx.vendorMatching.getVendorCrmMap(realmId);
    const byVendorName = new Map(
      crmMap.entries.map((entry) => [ctx.normalizeName(entry.vendorName), entry]),
    );

    return {
      breakdown: breakdown.map((bucket) => {
        const match =
          (bucket.id ? crmMap.byVendorId[bucket.id] : undefined) ??
          byVendorName.get(ctx.normalizeName(bucket.name));

        if (!match?.crmCompanyId) return bucket;
        return ctx.enrichVendorBreakdownBucket(bucket, match);
      }),
      warnings: [],
    };
  } catch {
    return {
      breakdown,
      warnings: [
        ctx.normalizer.warning(
          'VENDOR_CRM_MAP_FAILED',
          'Unable to enrich vendor breakdown with CRM supplier/subcontractor matches.',
        ),
      ],
    };
  }
}

export function enrichVendorBreakdownBucketEngine(
  bucket: QboJobCostBreakdown,
  match: QboVendorCrmEntry,
): QboJobCostBreakdown {
  return {
    ...bucket,
    crmCompanyId: match.crmCompanyId,
    crmCompanyName: match.crmCompanyName,
    ...(match.crmType && { crmType: match.crmType }),
    ...(match.matchConfidence !== undefined && {
      matchConfidence: match.matchConfidence,
    }),
    ...(match.matchMethod && { matchMethod: match.matchMethod }),
    matchStatus: match.matchStatus,
  };
}

