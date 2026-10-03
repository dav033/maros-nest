import {
  BreakdownContext,
  buildBreakdownEngine,
  buildExpenseBreakdownEngine,
  summarizeEngine,
} from './quickbooks-job-costing-breakdown.aggregation';
import { money } from '../core/qbo-value.utils';
import type { QboJobCostTransaction } from './quickbooks-job-costing.types';

/**
 * The two totals on a job cost report have to agree: the job's `totalJobCost` and the sum
 * of the per-vendor and per-category buckets that are supposed to decompose it. They did
 * not, because the buckets added `committedPo` and the job total did not.
 *
 * Verified against QuickBooks' Profit and Loss for 032P-0825 (customer 472): the report
 * says 190,814.28 in Accrual, which is what the job total reported; the buckets added up
 * to 192,958.97 — the 2,144.69 of open purchase orders on that job. An open PO is a
 * commitment, not a cost incurred; when the bill arrives it is counted through openAp.
 */
const ctx = {
  money,
  firstLineCategory: () => undefined,
  normalizeName: (v: string) => v.toLowerCase(),
} as unknown as BreakdownContext;

const txn = (
  classification: QboJobCostTransaction['classification'],
  allocatedAmount: number,
  vendorName: string,
): QboJobCostTransaction =>
  ({
    classification,
    allocatedAmount,
    vendor: { value: '1', name: vendorName },
    lineItems: [],
  }) as unknown as QboJobCostTransaction;

/** The shape of 032P-0825: paid cash, one open bill and one open purchase order. */
const job032P0825 = [
  txn('cash_out_paid', 190586.43, 'OPIFEX - SINGERGY'),
  txn('open_ap', 227.85, 'OPIFEX - SINGERGY'),
  txn('commitment', 2144.69, 'OPIFEX - SINGERGY'),
];

describe('job cost breakdown', () => {
  it('keeps the buckets adding up to the job total', () => {
    const summary = summarizeEngine(ctx, job032P0825);
    const buckets = buildBreakdownEngine(ctx, job032P0825, 'vendor');

    expect(summary.totalJobCost).toBe(190814.28);
    expect(money(buckets.reduce((sum, b) => sum + b.totalJobCost, 0))).toBe(
      summary.totalJobCost,
    );
  });

  it('leaves the open purchase order out of the bucket total', () => {
    const [bucket] = buildBreakdownEngine(ctx, job032P0825, 'vendor');

    // 192,958.97 before the fix.
    expect(bucket.totalJobCost).toBe(190814.28);
  });

  it('still reports the commitment on its own field', () => {
    const [bucket] = buildBreakdownEngine(ctx, job032P0825, 'vendor');

    expect(bucket.committedPo).toBe(2144.69);
  });

  /**
   * A vendor credit reduces what the job cost, so it has to come off the bucket as it comes
   * off the summary. Getting this sign wrong would make credits *add* to cost.
   */
  it('subtracts a vendor credit from the bucket, as the summary does', () => {
    const transactions = [
      txn('cash_out_paid', 1000, 'Acme'),
      txn('credit', 250, 'Acme'),
    ];

    const [bucket] = buildBreakdownEngine(ctx, transactions, 'vendor');

    expect(bucket.vendorCredits).toBe(250);
    expect(bucket.totalJobCost).toBe(750);
    expect(summarizeEngine(ctx, transactions).totalJobCost).toBe(750);
  });
});

/**
 * El desglose por cuenta de gasto, que es lo que la pantalla del proyecto
 * ensena como "cost of material" y "subcontractor".
 *
 * Lo que prueba este bloque es que la cuenta sale de la *linea* y no de la
 * cabecera. Agrupando por cabecera, el 032P-0825 repartia sus 190.586,43 entre
 * "L. LOZANO (6750)" y "BUS COMPLETE CHK (5052)" —de donde salio el dinero— y
 * 79.867,69 acababan bajo "Accounts Payable (A/P)", con subcontratistas en
 * 7.785,23 contra los 78.840,63 del Profit and Loss de QuickBooks.
 */
describe('buildExpenseBreakdownEngine', () => {
  const MATERIAL = { value: '185', name: 'Construction Materials Costs' };
  const SUBS = { value: '188', name: 'Subcontractors Expense' };
  const BANK = { value: '155', name: 'L. LOZANO (6750) - 1' };

  const paid = (
    vendorName: string,
    details: Array<{ category: { value: string; name: string }; amount: number }>,
  ): QboJobCostTransaction =>
    ({
      classification: 'cash_out_paid',
      allocatedAmount: details.reduce((sum, detail) => sum + detail.amount, 0),
      vendor: { value: vendorName, name: vendorName },
      // La cabecera es el banco, como en los datos reales: si el desglose la
      // mirase, todo caeria aqui.
      category: BANK,
      account: BANK,
      allocationDetails: details.map((detail) => ({
        basisAmount: detail.amount,
        projectBasisAmount: detail.amount,
        allocatedAmount: detail.amount,
        allocationRatio: 1,
        allocationMethod: 'project_line_amount',
        category: detail.category,
      })),
    }) as unknown as QboJobCostTransaction;

  it('groups by the account on the line, not the bank on the header', () => {
    const breakdown = buildExpenseBreakdownEngine(ctx, [
      paid('BOND PLUMBING', [{ category: MATERIAL, amount: 3772.61 }]),
      paid('MARC ANTHONYS', [{ category: SUBS, amount: 6500 }]),
    ]);

    expect(breakdown.map((bucket) => bucket.name)).toEqual([
      'Subcontractors Expense',
      'Construction Materials Costs',
    ]);
    expect(breakdown.find((b) => b.id === '185')?.totalJobCost).toBe(3772.61);
    expect(breakdown.find((b) => b.id === '188')?.totalJobCost).toBe(6500);
  });

  /** Una factura con material y subcontrata cuenta en las dos cuentas. */
  it('splits one transaction across the accounts of its lines', () => {
    const breakdown = buildExpenseBreakdownEngine(ctx, [
      paid('MIXTO SL', [
        { category: MATERIAL, amount: 750 },
        { category: SUBS, amount: 250 },
      ]),
    ]);

    expect(breakdown.find((b) => b.id === '185')?.totalJobCost).toBe(750);
    expect(breakdown.find((b) => b.id === '188')?.totalJobCost).toBe(250);
  });

  it('lists the vendors inside each account, biggest first', () => {
    const breakdown = buildExpenseBreakdownEngine(ctx, [
      paid('PEQUENO', [{ category: SUBS, amount: 500 }]),
      paid('GRANDE', [{ category: SUBS, amount: 40000 }]),
      paid('GRANDE', [{ category: SUBS, amount: 2000 }]),
    ]);

    const subs = breakdown.find((bucket) => bucket.id === '188');
    expect(subs?.vendors.map((vendor) => [vendor.name, vendor.totalJobCost])).toEqual([
      ['GRANDE', 42000],
      ['PEQUENO', 500],
    ]);
    // Dos transacciones del mismo proveedor son un proveedor con dos
    // transacciones, no dos filas.
    expect(subs?.vendors[0].transactionCount).toBe(2);
  });

  /** La suma de los buckets tiene que ser el coste del proyecto. */
  it('adds up to the job total', () => {
    const transactions = [
      paid('A', [{ category: MATERIAL, amount: 105600.23 }]),
      paid('B', [{ category: SUBS, amount: 78840.63 }]),
    ];

    const breakdown = buildExpenseBreakdownEngine(ctx, transactions);
    const sum = breakdown.reduce((acc, bucket) => acc + bucket.totalJobCost, 0);

    expect(money(sum)).toBe(184440.86);
  });

  /**
   * Una transaccion sin detalles cae a su cabecera. Es lo unico que se sabe de
   * ella, y descartarla haria que el desglose dejase de sumar el total — un
   * desglose que no cuadra con su propia cifra es peor que uno impreciso.
   */
  it('falls back to the header when there are no allocation details', () => {
    const bare = {
      classification: 'cash_out_paid',
      allocatedAmount: 250,
      vendor: { value: 'X', name: 'X' },
      category: BANK,
      account: BANK,
      allocationDetails: [],
    } as unknown as QboJobCostTransaction;

    const breakdown = buildExpenseBreakdownEngine(ctx, [bare]);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].name).toBe('L. LOZANO (6750) - 1');
    expect(breakdown[0].totalJobCost).toBe(250);
  });
});
