import { QboAiWarning } from '../core/quickbooks-normalizer.service';
import {
  QboJobCostBreakdown,
  QboJobCostExpenseBreakdown,
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
  transactions: Array<Pick<QboJobCostTransaction, 'classification' | 'allocatedAmount'>>,
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
    // Mismo total que summarizeEngine y buildFullProjectSummary, y por el mismo motivo:
    // un purchase order abierto es un compromiso, no un coste incurrido, y cuando llegue
    // la factura entrara por openAp. Sumarlo aqui hacia que los cubos no cuadraran con el
    // total de la obra: en 032P-0825 sumaban 192.958,97 contra los 190.814,28 del
    // Profit and Loss, exactamente los 2.144,69 de PO abierto. committedPo sigue
    // publicandose en su propio campo.
    bucket.totalJobCost =
      bucket.cashOutPaid +
      bucket.openAp +
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


/**
 * Desglose por cuenta de gasto, con los proveedores dentro de cada una.
 *
 * Esto no es lo mismo que `categoryBreakdown`, y la diferencia es el motivo de
 * que exista: aquel agrupa transacciones enteras por `txn.category`, que en la
 * cabecera de un pago es el banco o la tarjeta, de modo que el 032P-0825 sale
 * repartido entre "L. LOZANO (6750)" y "BUS COMPLETE CHK (5052)" — de donde
 * salio el dinero, no en que se gasto.
 *
 * Este recorre los `allocationDetails`, que llevan la cuenta de cada linea y el
 * importe ya asignado al proyecto por el motor de reparto. No se reimplementa
 * la regla de reparto: reimplementarla es como se reintroduce el doble conteo
 * que costo arreglar en las 82 obras.
 *
 * Una transaccion sin detalles cae a su cabecera, que es lo unico que se sabe
 * de ella; es mejor que descartarla y que el desglose deje de sumar el total.
 */
export function buildExpenseBreakdownEngine(
  ctx: Pick<BreakdownContext, 'money' | 'firstLineCategory'>,
  transactions: QboJobCostTransaction[],
): QboJobCostExpenseBreakdown[] {
  const buckets = new Map<string, QboJobCostExpenseBreakdown>();

  const bucketFor = (ref: { name?: string; value?: string } | undefined) => {
    const name = ref?.name || ref?.value || 'Sin categoría';
    const id = ref?.value || undefined;
    const key = `${id ?? ''}:${name}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: QboJobCostExpenseBreakdown = {
      ...(id && { id }),
      name,
      cashOutPaid: 0,
      openAp: 0,
      committedPo: 0,
      vendorCredits: 0,
      adjustedCosts: 0,
      totalJobCost: 0,
      transactionCount: 0,
      vendors: [],
    };
    buckets.set(key, created);
    return created;
  };

  const addAmount = (
    bucket: QboJobCostExpenseBreakdown | QboJobCostBreakdown,
    classification: QboJobCostTransaction['classification'],
    amount: number,
  ) => {
    switch (classification) {
      case 'cash_out_paid':
        bucket.cashOutPaid += amount;
        break;
      case 'open_ap':
        bucket.openAp += amount;
        break;
      case 'commitment':
        bucket.committedPo += amount;
        break;
      case 'credit':
        bucket.vendorCredits += amount;
        break;
      default:
        bucket.adjustedCosts += amount;
        break;
    }
    bucket.totalJobCost += amount;
    bucket.transactionCount += 1;
  };

  for (const txn of transactions) {
    const vendorName = txn.vendor?.name || txn.vendor?.value || 'Sin proveedor';
    const vendorId = txn.vendor?.value;
    const details = txn.allocationDetails.length
      ? txn.allocationDetails.map((detail) => ({
          ref: detail.category,
          amount: detail.allocatedAmount,
        }))
      : [
          {
            ref: txn.category ?? txn.account ?? ctx.firstLineCategory(txn),
            amount: txn.allocatedAmount,
          },
        ];

    for (const { ref, amount } of details) {
      if (amount === 0) continue;
      const bucket = bucketFor(ref);
      addAmount(bucket, txn.classification, amount);

      const vendorKey = `${vendorId ?? ''}:${vendorName}`;
      let vendor = bucket.vendors.find(
        (candidate) => `${candidate.id ?? ''}:${candidate.name}` === vendorKey,
      );
      if (!vendor) {
        vendor = {
          ...(vendorId && { id: vendorId }),
          name: vendorName,
          cashOutPaid: 0,
          openAp: 0,
          committedPo: 0,
          vendorCredits: 0,
          adjustedCosts: 0,
          totalJobCost: 0,
          transactionCount: 0,
        };
        bucket.vendors.push(vendor);
      }
      addAmount(vendor, txn.classification, amount);
    }
  }

  const rounded = [...buckets.values()].map((bucket) => ({
    ...bucket,
    cashOutPaid: ctx.money(bucket.cashOutPaid),
    openAp: ctx.money(bucket.openAp),
    committedPo: ctx.money(bucket.committedPo),
    vendorCredits: ctx.money(bucket.vendorCredits),
    adjustedCosts: ctx.money(bucket.adjustedCosts),
    totalJobCost: ctx.money(bucket.totalJobCost),
    vendors: bucket.vendors
      .map((vendor) => ({
        ...vendor,
        cashOutPaid: ctx.money(vendor.cashOutPaid),
        openAp: ctx.money(vendor.openAp),
        committedPo: ctx.money(vendor.committedPo),
        vendorCredits: ctx.money(vendor.vendorCredits),
        adjustedCosts: ctx.money(vendor.adjustedCosts),
        totalJobCost: ctx.money(vendor.totalJobCost),
      }))
      .sort((a, b) => b.totalJobCost - a.totalJobCost),
  }));

  return rounded.sort((a, b) => b.totalJobCost - a.totalJobCost);
}
