import {
  AllocationContext,
  CostLineFilter,
  allocateBillOpenApEngine,
  allocateBillPaymentEngine,
  allocateJournalEntryEngine,
  allocateTransactionToProjectEngine,
  paymentAllocationLinesEngine,
} from './quickbooks-job-costing-allocation.engine';
import { QuickbooksJobCostingUtils } from './quickbooks-job-costing.utils';
import {
  buildAccountIndex,
  unknownAccountIndex,
} from './quickbooks-job-costing-accounts';
import type { QboResolvedProjectRef } from './quickbooks-job-costing.types';
import type {
  QboAiWarning,
  QboNormalizedLine,
  QboNormalizedTransaction,
} from '../core/quickbooks-normalizer.types';

/**
 * These functions decide which project each QuickBooks dollar is charged to. A bug here
 * does not throw — it quietly moves cost between jobs, and the first anyone hears of it is
 * a job cost report that does not match reality.
 *
 * The harness therefore runs the *real* arithmetic: it extends QuickbooksJobCostingUtils,
 * so money(), ratio(), lineBasisAmount(), lineMatchesProject() and the allocation
 * constructors are the production implementations. Only the normalizer (which parses
 * QuickBooks payloads) is stubbed, and the engine delegations are wired exactly as
 * QuickbooksJobCostingBase wires them. Stubbing the maths would have made these tests
 * assert the stubs.
 */
class AllocationHarness extends QuickbooksJobCostingUtils {
  readonly normalizer = {
    normalizePurchase: jest.fn(),
    normalizeBill: jest.fn((raw: Record<string, unknown>) => raw as never),
    normalizeBillPayment: jest.fn(),
    normalizeVendorCredit: jest.fn(),
    normalizePurchaseOrder: jest.fn(),
    normalizeJournalEntry: jest.fn(),
    normalizeDeposit: jest.fn(),
    warning: (code: string, message: string): QboAiWarning => ({ code, message }),
  };

  constructor() {
    // The pure allocation helpers never reach the API or the financials service.
    super(undefined as never, undefined as never);
  }

  // Mirrors QuickbooksJobCostingBase: the engine asks the context for these, and the
  // context answers by calling the engine back.
  allocateTransactionToProject(
    txn: QboNormalizedTransaction,
    project: QboResolvedProjectRef | undefined,
    requireProjectMatch: boolean,
    isCostLine: CostLineFilter,
  ) {
    return allocateTransactionToProjectEngine(
      this.ctx,
      txn,
      project,
      requireProjectMatch,
      isCostLine,
    );
  }

  paymentAllocationLines(rawPayment: Record<string, unknown>, txn: QboNormalizedTransaction) {
    return paymentAllocationLinesEngine(this.ctx, rawPayment, txn);
  }

  get ctx(): AllocationContext {
    return this as unknown as AllocationContext;
  }
}

function harness() {
  const h = new AllocationHarness();
  return { h, ctx: h.ctx };
}

/**
 * The filter these tests pass when they are asserting arithmetic rather than account
 * classification: it is what `countsAsCost` answers for a line whose account cannot be
 * classified, so it keeps every line, which is the behaviour this engine had before the
 * chart of accounts reached it.
 */
const everyLineIsCost: CostLineFilter = (line) => unknownAccountIndex.countsAsCost(line);

// --- fixtures ---------------------------------------------------------------

const line = (over: Partial<QboNormalizedLine> = {}): QboNormalizedLine => ({
  amount: 0,
  description: '',
  detailType: 'AccountBasedExpenseLineDetail',
  projectRefs: [],
  ...over,
});

const txn = (over: Partial<QboNormalizedTransaction> = {}): QboNormalizedTransaction => ({
  source: 'quickbooks',
  direction: 'cash_out',
  entityType: 'Bill',
  entityId: '1',
  docNumber: '',
  txnDate: '2026-01-15',
  totalAmount: 0,
  projectRefs: [],
  lineItems: [],
  linkedTxn: [],
  memo: '',
  description: '',
  attachments: [],
  warnings: [],
  ...over,
});

/** The job as resolved from QuickBooks: customer id 900, named "091-0626 Fence". */
const project: QboResolvedProjectRef = {
  found: true,
  projectNumber: '091-0626',
  displayName: '091-0626 Fence',
  qboCustomerId: '900',
  refs: [{ value: '900', name: '091-0626 Fence' }],
};

const onProject = { value: '900', name: '091-0626 Fence' };
const onOtherJob = { value: '901', name: '075P-0926 Duplex' };

// ---------------------------------------------------------------------------

describe('allocateTransactionToProjectEngine', () => {
  it('charges the whole transaction when no project filter is asked for', () => {
    const { ctx } = harness();

    const result = allocateTransactionToProjectEngine(ctx, txn({ totalAmount: 1200.5 }), project, false, everyLineIsCost);

    expect(result.amount).toBe(1200.5);
    expect(result.ratio).toBe(1);
    expect(result.method).toBe('full_transaction');
  });

  it('charges only the lines that name the project', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 1000,
      lineItems: [
        line({ amount: 300, projectRefs: [onProject] }),
        line({ amount: 700, projectRefs: [onOtherJob] }),
      ],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(300);
    expect(result.basisAmount).toBe(1000);
    expect(result.ratio).toBe(0.3);
    expect(result.method).toBe('project_line_amount');
    expect(result.details).toHaveLength(1);
    expect(result.details[0].allocatedAmount).toBe(300);
  });

  it('adds up several matching lines', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 1000,
      lineItems: [
        line({ amount: 250, projectRefs: [onProject] }),
        line({ amount: 150, projectRefs: [onProject] }),
        line({ amount: 600, projectRefs: [onOtherJob] }),
      ],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(400);
    expect(result.ratio).toBe(0.4);
    expect(result.details).toHaveLength(2);
  });

  it('matches a line by the project name when the customer id is absent', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 500,
      lineItems: [line({ amount: 500, projectRefs: [{ value: '', name: '091-0626 Fence' }] })],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(500);
  });

  it('falls back to the whole transaction when only the header names the project', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 800,
      projectRefs: [onProject],
      lineItems: [line({ amount: 800 })],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(800);
    expect(result.method).toBe('project_header_full');
  });

  it('charges nothing when neither the header nor any line names the project', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 900,
      projectRefs: [onOtherJob],
      lineItems: [line({ amount: 900, projectRefs: [onOtherJob] })],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(0);
    expect(result.method).toBe('no_project_match');
    expect(result.details).toEqual([]);
  });

  /**
   * A JournalEntry has no TotalAmt, so totalAmount is null. Null is not zero: an amount
   * nobody can know must not be reported as a transaction worth nothing.
   */
  it('reports an unknown amount as unknown, not as zero', () => {
    const { ctx } = harness();

    const result = allocateTransactionToProjectEngine(ctx, txn({ totalAmount: null }), project, false, everyLineIsCost);

    expect(result.amount).toBe(0);
    expect(result.method).toBe('full_transaction_amount_unknown');
  });

  it('rounds to cents rather than carrying floating point noise', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 0.3,
      lineItems: [
        line({ amount: 0.1, projectRefs: [onProject] }),
        line({ amount: 0.2, projectRefs: [onProject] }),
      ],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    // 0.1 + 0.2 === 0.30000000000000004 before money() gets to it.
    expect(result.amount).toBe(0.3);
  });

  /**
   * Change orders are separate QuickBooks customers, and they are named after the job they
   * extend: the base job is "020P-0725, 2100 NE 15th Street" and its change orders are
   * "020P-0725, COO1 2100 NE 15th Street" and "020P-0725, CO02 2100 NE 15th Street". The
   * name test accepts anything starting with the project number and a comma, so falling
   * back to the name made the base job absorb its change orders' cost — and since each
   * change order is its own job in the CRM, the same dollars were counted twice.
   *
   * Measured against QuickBooks' own Profit and Loss for customer 316 (020P-0725):
   * the app reported 21,466.21 against the report's 18,763.32 in both Cash and Accrual.
   * The 2,702.89 gap was four lines belonging to customers 344 and 357 — the change
   * orders — of which 2,352.89 was whole transactions and 500.00 was one line of a
   * 1,000.00 purchase split across the base job and CO02.
   */
  it('does not charge a change order to the job it extends', () => {
    const { ctx } = harness();
    const baseJob: QboResolvedProjectRef = {
      found: true,
      projectNumber: '020P-0725',
      displayName: '020P-0725, 2100 NE 15th Street, Fort Lauderdale, FL 33304',
      qboCustomerId: '316',
      refs: [{ value: '316', name: '020P-0725, 2100 NE 15th Street, Fort Lauderdale, FL 33304' }],
    };
    const purchase2792 = txn({
      entityType: 'Purchase',
      totalAmount: 1000,
      lineItems: [
        line({
          amount: 500,
          projectRefs: [
            { value: '316', name: '020P-0725, 2100 NE 15th Street, Fort Lauderdale, FL 33304' },
          ],
        }),
        line({
          amount: 500,
          projectRefs: [
            { value: '357', name: '020P-0725, CO02 2100 NE 15th Street, Fort Lauderdale, FL 33304' },
          ],
        }),
      ],
    });

    const result = allocateTransactionToProjectEngine(ctx, purchase2792, baseJob, true, everyLineIsCost);

    expect(result.amount).toBe(500);
    expect(result.details).toHaveLength(1);
  });

  /**
   * Job cost is what the Profit and Loss calls cost, and that is decided by the account a
   * line posts to. These two live purchases were charged in full to their jobs although
   * QuickBooks puts neither on the cost side of the report.
   *
   * Purchase 4493: a returned deposited check of 28,800 posted to the *income* account
   * "Services" and tagged to job 061-0226. QuickBooks books it as negative income; the app
   * reported it as 28,800 of cost.
   *
   * Purchase 4165: an ATM withdrawal of 1,000 posted to the *asset* account "Cash on
   * hand" and tagged to 050P-0326 — checking account to petty cash, not a cost at all.
   *
   * Together they were 29,800 of the 64,723.60 those two jobs were overstated by.
   */
  describe('a line posted to an account that is not cost', () => {
    const chart = buildAccountIndex([
      { Id: '5', Name: 'Services', Classification: 'Revenue' },
      { Id: '170', Name: 'Cash on hand', Classification: 'Asset' },
      { Id: '188', Name: '53600 Subcontractors Expense', Classification: 'Expense' },
    ]);
    const costLine: CostLineFilter = (l) => chart.countsAsCost(l);

    it.each([
      ['Purchase 4493, a returned check posted to income', 28800, '5'],
      ['Purchase 4165, an ATM withdrawal posted to an asset', 1000, '170'],
    ])('charges nothing for %s', (_label, amount, accountId) => {
      const { ctx } = harness();
      const purchase = txn({
        entityType: 'Purchase',
        totalAmount: amount,
        lineItems: [
          line({ amount, account: { value: accountId }, projectRefs: [onProject] }),
        ],
      });

      const result = allocateTransactionToProjectEngine(ctx, purchase, project, true, costLine);

      expect(result.amount).toBe(0);
      expect(result.method).toBe('no_cost_account_line');
    });

    it('still charges the cost lines of a document that mixes both', () => {
      const { ctx } = harness();
      const purchase = txn({
        entityType: 'Purchase',
        totalAmount: 1500,
        lineItems: [
          line({ amount: 1000, account: { value: '188' }, projectRefs: [onProject] }),
          line({ amount: 500, account: { value: '170' }, projectRefs: [onProject] }),
        ],
      });

      const result = allocateTransactionToProjectEngine(ctx, purchase, project, true, costLine);

      expect(result.amount).toBe(1000);
      // The basis stays the whole document: the open balance of a bill like this is only
      // this job's in the cost line's proportion of the entire bill, not of its cost part.
      expect(result.basisAmount).toBe(1500);
    });

    /**
     * The inverse failure, and the one that matters more: an account the chart cannot
     * classify must not make real cost disappear. `countsAsCost` only excludes a line it
     * positively knows is not cost.
     */
    it.each([
      ['an account missing from the chart', { value: '999999' }],
      ['no account at all', undefined],
    ])('keeps a cost line with %s', (_label, account) => {
      const { ctx } = harness();
      const purchase = txn({
        entityType: 'Purchase',
        totalAmount: 400,
        lineItems: [line({ amount: 400, ...(account && { account }), projectRefs: [onProject] })],
      });

      const result = allocateTransactionToProjectEngine(ctx, purchase, project, true, costLine);

      expect(result.amount).toBe(400);
    });

    it('keeps every line when the chart of accounts could not be read at all', () => {
      const { ctx } = harness();
      const purchase = txn({
        entityType: 'Purchase',
        totalAmount: 28800,
        lineItems: [line({ amount: 28800, account: { value: '5' }, projectRefs: [onProject] })],
      });

      const result = allocateTransactionToProjectEngine(
        ctx,
        purchase,
        project,
        true,
        (l) => unknownAccountIndex.countsAsCost(l),
      );

      expect(result.amount).toBe(28800);
    });

    it('leaves a document with no lines on its header total, as before', () => {
      const { ctx } = harness();
      const purchase = txn({
        entityType: 'Purchase',
        totalAmount: 250,
        lineItems: [],
        projectRefs: [onProject],
      });

      const result = allocateTransactionToProjectEngine(ctx, purchase, project, true, costLine);

      expect(result.amount).toBe(250);
      expect(result.method).toBe('project_header_full');
    });
  });

  /**
   * A Deposit is money arriving, and the normalizer has already negated it. Only the lines
   * posting to an expense account are cost reversals, so the engine asks `reversesCost`,
   * which answers yes only when the chart positively says the account is an expense one.
   *
   * Deposit 4387 in the live file: 34,923.60 against "60400 Bank Services Charges", tagged
   * to job 061-0226, cancelling a 36,000 charge on the same account so that QuickBooks'
   * Profit and Loss shows 1,076.40. Deposit was never queried, so the app reported 36,000.
   */
  describe('a deposit line', () => {
    const chart = buildAccountIndex([
      { Id: '1150040003', Name: '60400 Bank Services Charges', Classification: 'Expense' },
      { Id: '5', Name: 'Services', Classification: 'Revenue' },
    ]);
    const reversal: CostLineFilter = (l) => chart.reversesCost(l);

    it('comes off the job when it posts to an expense account', () => {
      const { ctx } = harness();
      const deposit4387 = txn({
        entityType: 'Deposit',
        totalAmount: -34923.6,
        lineItems: [
          line({
            amount: -34923.6,
            detailType: 'DepositLineDetail',
            account: { value: '1150040003' },
            projectRefs: [onProject],
          }),
        ],
      });

      const result = allocateTransactionToProjectEngine(ctx, deposit4387, project, true, reversal);

      expect(result.amount).toBe(-34923.6);
    });

    it('is left alone when it is a customer payment against an income account', () => {
      const { ctx } = harness();
      const payment = txn({
        entityType: 'Deposit',
        totalAmount: -28800,
        lineItems: [
          line({
            amount: -28800,
            detailType: 'DepositLineDetail',
            account: { value: '5' },
            projectRefs: [onProject],
          }),
        ],
      });

      const result = allocateTransactionToProjectEngine(ctx, payment, project, true, reversal);

      expect(result.amount).toBe(0);
      expect(result.method).toBe('no_cost_account_line');
    });

    /** Deposit 4386: 36,000 of customer payment whose line names no account. */
    it('is left alone when its line names no account', () => {
      const { ctx } = harness();
      const deposit4386 = txn({
        entityType: 'Deposit',
        totalAmount: -36000,
        lineItems: [
          line({ amount: -36000, detailType: 'DepositLineDetail', projectRefs: [onProject] }),
        ],
      });

      const result = allocateTransactionToProjectEngine(ctx, deposit4386, project, true, reversal);

      expect(result.amount).toBe(0);
    });

    it('reverses nothing when the chart of accounts could not be read', () => {
      const { ctx } = harness();
      const deposit4387 = txn({
        entityType: 'Deposit',
        totalAmount: -34923.6,
        lineItems: [
          line({
            amount: -34923.6,
            account: { value: '1150040003' },
            projectRefs: [onProject],
          }),
        ],
      });

      const result = allocateTransactionToProjectEngine(
        ctx,
        deposit4387,
        project,
        true,
        (l) => unknownAccountIndex.reversesCost(l),
      );

      expect(result.amount).toBe(0);
    });
  });

  /**
   * The inverse mistake would be worse: a ref whose name is the only identity it has must
   * still land on the job, or every name-only reference silently drops off the cost.
   * QuickBooks returns these as `name` with no `value`, which is why the normalizer raises
   * PROJECT_REF_NAME_ONLY for them.
   */
  it('still matches a reference that has a name but no id', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 400,
      lineItems: [line({ amount: 400, projectRefs: [{ value: '', name: '091-0626 Fence' }] })],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(400);
  });

  /**
   * And when the job itself could not be resolved to a QuickBooks customer, the name is
   * all there is on both sides: requiring an id match there would zero out the job.
   */
  it('falls back to the name when the job has no QuickBooks id', () => {
    const { ctx } = harness();
    const unresolved: QboResolvedProjectRef = {
      found: false,
      projectNumber: '091-0626',
      refs: [{ value: '', name: '091-0626' }],
    };
    const bill = txn({
      totalAmount: 400,
      lineItems: [line({ amount: 400, projectRefs: [{ value: '900', name: '091-0626' }] })],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, unresolved, true, everyLineIsCost);

    expect(result.amount).toBe(400);
  });
});

describe('allocateBillOpenApEngine', () => {
  it('charges nothing for a bill that is already paid', () => {
    const { ctx } = harness();

    const result = allocateBillOpenApEngine(
      ctx,
      txn({ totalAmount: 1000, openBalance: 0 }),
      project,
      true,
      everyLineIsCost,
    );

    expect(result.amount).toBe(0);
    expect(result.method).toBe('bill_closed');
  });

  it('charges the whole open balance for a bill entirely on the project', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 1000,
      openBalance: 400,
      projectRefs: [onProject],
      lineItems: [line({ amount: 1000 })],
    });

    const result = allocateBillOpenApEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(400);
    expect(result.method).toBe('open_ap_full');
  });

  /**
   * The case worth getting right: a bill split between two jobs and partly paid. The open
   * AP owed on *this* job is the project's share of what is still outstanding — not the
   * whole open balance, and not the project's full line total.
   */
  it('charges only the project share of what is still outstanding', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 1000,
      openBalance: 500,
      lineItems: [
        line({ amount: 300, projectRefs: [onProject] }),
        line({ amount: 700, projectRefs: [onOtherJob] }),
      ],
    });

    const result = allocateBillOpenApEngine(ctx, bill, project, true, everyLineIsCost);

    // 30% of the bill is this job's, and 500 is still open: 150.
    expect(result.amount).toBe(150);
    expect(result.ratio).toBe(0.3);
    expect(result.method).toBe('open_ap_project_line_ratio');
    expect(result.details[0].allocatedAmount).toBe(150);
  });

  it('charges nothing on an open bill that has nothing to do with the project', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 1000,
      openBalance: 1000,
      lineItems: [line({ amount: 1000, projectRefs: [onOtherJob] })],
    });

    const result = allocateBillOpenApEngine(ctx, bill, project, true, everyLineIsCost);

    expect(result.amount).toBe(0);
    expect(result.method).toBe('no_project_match');
  });
});

describe('allocateBillPaymentEngine', () => {
  const payment = (lines: Array<{ amount: number; billIds: string[] }>) => ({
    Line: lines.map((l) => ({
      Amount: l.amount,
      LinkedTxn: l.billIds.map((id) => ({ TxnId: id, TxnType: 'Bill' })),
    })),
  });

  it('charges the whole payment when no project filter is asked for', () => {
    const { ctx } = harness();

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 500, billIds: ['10'] }]),
      txn({ totalAmount: 500 }),
      new Map(),
      project,
      false,
      [],
      everyLineIsCost,
    );

    expect(result.amount).toBe(500);
    expect(result.method).toBe('linked_bill_full');
  });

  /**
   * El desglose por cuenta de gasto de un pago de factura.
   *
   * Las lineas de un BillPayment van contra Cuentas por Pagar: la cuenta de
   * gasto esta en la factura. Antes se tomaba la cabecera de la factura, que es
   * A/P tambien, y el efecto era medible en el job 032P-0825: de 190.586,43 de
   * coste, 79.867,69 se agrupaban bajo "Accounts Payable (A/P)". Subcontratistas
   * salia 7.785,23 contra los 78.840,63 del Profit and Loss de QuickBooks.
   */
  it('takes the expense account from the bill, not from the payment', () => {
    const { h, ctx } = harness();
    h.normalizer.normalizeBill.mockReturnValue(
      txn({
        entityId: '3323',
        totalAmount: 6500,
        category: { value: '7', name: 'Accounts Payable (A/P)' },
        lineItems: [
          line({
            amount: 6500,
            projectRefs: [onProject],
            account: { value: '188', name: 'Subcontractors Expense' },
          }),
        ],
      }) as never,
    );

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 6500, billIds: ['3323'] }]),
      txn({ entityType: 'BillPayment', entityId: '99', totalAmount: 6500 }),
      new Map([['3323', { Id: '3323' }]]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    expect(result.amount).toBe(6500);
    expect(result.details).toHaveLength(1);
    expect(result.details[0].category).toEqual({
      value: '188',
      name: 'Subcontractors Expense',
    });
  });

  /** Una factura con material y subcontrata se parte entre las dos cuentas. */
  it('splits a payment across the two expense accounts of one bill', () => {
    const { h, ctx } = harness();
    h.normalizer.normalizeBill.mockReturnValue(
      txn({
        entityId: '10',
        totalAmount: 1000,
        lineItems: [
          line({
            amount: 750,
            projectRefs: [onProject],
            account: { value: '185', name: 'Construction Materials Costs' },
          }),
          line({
            amount: 250,
            projectRefs: [onProject],
            account: { value: '188', name: 'Subcontractors Expense' },
          }),
        ],
      }) as never,
    );

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 1000, billIds: ['10'] }]),
      txn({ entityType: 'BillPayment', totalAmount: 1000 }),
      new Map([['10', { Id: '10' }]]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    expect(result.amount).toBe(1000);
    const byAccount = Object.fromEntries(
      result.details.map((detail) => [detail.category?.value, detail.allocatedAmount]),
    );
    expect(byAccount).toEqual({ '185': 750, '188': 250 });
  });

  /**
   * Lo que no puede cambiar: el dinero. El reparto decide a que cuenta se imputa,
   * no cuanto, asi que los trozos tienen que sumar el mismo importe al centimo
   * aunque la division no sea exacta — un desglose que no suma su propio total es
   * el fallo que ya costo arreglar una vez en los buckets del job cost.
   */
  it('keeps the total to the cent when the split does not divide evenly', () => {
    const { h, ctx } = harness();
    h.normalizer.normalizeBill.mockReturnValue(
      txn({
        entityId: '10',
        totalAmount: 100,
        lineItems: [
          line({ amount: 33.33, projectRefs: [onProject], account: { value: 'a', name: 'A' } }),
          line({ amount: 33.33, projectRefs: [onProject], account: { value: 'b', name: 'B' } }),
          line({ amount: 33.34, projectRefs: [onProject], account: { value: 'c', name: 'C' } }),
        ],
      }) as never,
    );

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 100, billIds: ['10'] }]),
      txn({ entityType: 'BillPayment', totalAmount: 100 }),
      new Map([['10', { Id: '10' }]]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    const sum = result.details.reduce((acc, detail) => acc + detail.allocatedAmount, 0);
    expect(Number(sum.toFixed(2))).toBe(result.amount);
    expect(result.amount).toBe(100);
  });

  it('follows the payment through to the bill it paid', () => {
    const { h, ctx } = harness();
    const bill = txn({
      entityId: '10',
      totalAmount: 1000,
      projectRefs: [onProject],
      lineItems: [line({ amount: 1000 })],
    });
    h.normalizer.normalizeBill.mockReturnValue(bill as never);

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 400, billIds: ['10'] }]),
      txn({ entityId: '99', totalAmount: 400 }),
      new Map([['10', { Id: '10' }]]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    expect(result.amount).toBe(400);
    expect(result.details[0].linkedTxnId).toBe('10');
    expect(result.details[0].sourceEntityType).toBe('Bill');
  });

  /**
   * A payment that settles a bill only 30% on this job charges 30% of the cash. Paying the
   * bill does not move the other job's cost onto this one.
   */
  it('charges the project share of a payment for a split bill', () => {
    const { h, ctx } = harness();
    h.normalizer.normalizeBill.mockReturnValue(
      txn({
        entityId: '10',
        totalAmount: 1000,
        lineItems: [
          line({ amount: 300, projectRefs: [onProject] }),
          line({ amount: 700, projectRefs: [onOtherJob] }),
        ],
      }) as never,
    );

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 1000, billIds: ['10'] }]),
      txn({ totalAmount: 1000 }),
      new Map([['10', { Id: '10' }]]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    expect(result.amount).toBe(300);
    expect(result.method).toBe('linked_bill_project_line_ratio');
  });

  it('splits one payment line evenly across the bills it settles', () => {
    const { h, ctx } = harness();
    h.normalizer.normalizeBill.mockImplementation((raw: Record<string, unknown>) =>
      txn({
        entityId: String(raw['Id']),
        totalAmount: 500,
        // Only bill 10 is on this project; bill 11 belongs to another job.
        projectRefs: raw['Id'] === '10' ? [onProject] : [onOtherJob],
        lineItems: [line({ amount: 500 })],
      }) as never,
    );

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 1000, billIds: ['10', '11'] }]),
      txn({ totalAmount: 1000 }),
      new Map([
        ['10', { Id: '10' }],
        ['11', { Id: '11' }],
      ]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    // 1000 over two bills is 500 each; only bill 10 is this job's.
    expect(result.amount).toBe(500);
    expect(result.details).toHaveLength(1);
  });

  it('warns rather than guessing when the paid bill was not fetched', () => {
    const { ctx } = harness();
    const warnings: QboAiWarning[] = [];

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 400, billIds: ['10'] }]),
      txn({ entityId: '99', totalAmount: 400 }),
      new Map(),
      project,
      true,
      warnings,
      everyLineIsCost,
    );

    expect(result.amount).toBe(0);
    expect(result.method).toBe('no_linked_project_bill');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('LINKED_BILL_NOT_AVAILABLE');
  });

  it('charges nothing when none of the paid bills touch the project', () => {
    const { h, ctx } = harness();
    h.normalizer.normalizeBill.mockReturnValue(
      txn({ totalAmount: 500, lineItems: [line({ amount: 500, projectRefs: [onOtherJob] })] }) as never,
    );

    const result = allocateBillPaymentEngine(
      ctx,
      payment([{ amount: 500, billIds: ['11'] }]),
      txn({ totalAmount: 500 }),
      new Map([['11', { Id: '11' }]]),
      project,
      true,
      [],
      everyLineIsCost,
    );

    expect(result.amount).toBe(0);
    expect(result.method).toBe('no_linked_project_bill');
  });
});

describe('allocateJournalEntryEngine', () => {
  const je = (lines: Array<{ amount: number; account: string; posting: string; detailType?: string }>) => ({
    Line: lines.map((l) => ({
      DetailType: l.detailType ?? 'JournalEntryLineDetail',
      Amount: l.amount,
      JournalEntryLineDetail: { PostingType: l.posting },
    })),
  });

  it('charges a debit to an expense account as cost', () => {
    const { ctx } = harness();
    const entry = txn({
      entityType: 'JournalEntry',
      totalAmount: null,
      lineItems: [line({ amount: 250, account: { value: '1', name: 'Job Expense' } })],
    });

    const result = allocateJournalEntryEngine(
      ctx,
      je([{ amount: 250, account: 'Job Expense', posting: 'Debit' }]),
      entry,
      project,
      false,
      unknownAccountIndex,
    );

    expect(result.amount).toBe(250);
    expect(result.method).toBe('journal_expense_cogs_line');
  });

  /** A credit to a cost account reduces the job's cost; charging it as positive would double it. */
  it('subtracts a credit instead of adding it', () => {
    const { ctx } = harness();
    const entry = txn({
      entityType: 'JournalEntry',
      totalAmount: null,
      lineItems: [line({ amount: 250, account: { value: '1', name: 'Materials' } })],
    });

    const result = allocateJournalEntryEngine(
      ctx,
      je([{ amount: 250, account: 'Materials', posting: 'Credit' }]),
      entry,
      project,
      false,
      unknownAccountIndex,
    );

    expect(result.amount).toBe(-250);
  });

  it('ignores a line posted to an account that is not a cost account', () => {
    const { ctx } = harness();
    const entry = txn({
      entityType: 'JournalEntry',
      totalAmount: null,
      lineItems: [line({ amount: 250, account: { value: '2', name: 'Accounts Receivable' } })],
    });

    const result = allocateJournalEntryEngine(
      ctx,
      je([{ amount: 250, account: 'Accounts Receivable', posting: 'Debit' }]),
      entry,
      project,
      false,
      unknownAccountIndex,
    );

    expect(result.amount).toBe(0);
    expect(result.method).toBe('journal_not_explicit_cost');
  });

  /**
   * QuickBooks interleaves subtotal rows that have no counterpart in the normalized line
   * list. The engine must not advance its index for them, or every amount after the first
   * subtotal is read off the wrong line.
   *
   * The DetailType here is `SubTotalLineDetail`, which is what QuickBooks actually sends.
   * These fixtures used to say `'SubTotalLine'`, a value that appears nowhere in the API,
   * so they passed while the real row was still being counted.
   */
  it('stays aligned when QuickBooks interleaves a subtotal line', () => {
    const { ctx } = harness();
    const entry = txn({
      entityType: 'JournalEntry',
      totalAmount: null,
      lineItems: [
        line({ amount: 100, account: { value: '1', name: 'Labor' } }),
        line({ amount: 400, account: { value: '1', name: 'Materials' } }),
      ],
    });

    const result = allocateJournalEntryEngine(
      ctx,
      je([
        { amount: 100, account: 'Labor', posting: 'Debit' },
        { amount: 0, account: '', posting: '', detailType: 'SubTotalLineDetail' },
        { amount: 400, account: 'Materials', posting: 'Debit' },
      ]),
      entry,
      project,
      false,
      unknownAccountIndex,
    );

    expect(result.amount).toBe(500);
    expect(result.details).toHaveLength(2);
    // The regression: the line after the subtotal used to be pushed twice, so this was
    // 900 across three details and the job was charged for 400 it never incurred.
    expect(result.details.map((detail) => detail.allocatedAmount)).toEqual([100, 400]);
  });

  /**
   * Which journal lines are cost used to be guessed from the account's *name* — it had to
   * contain "expense", "cogs", "materials", "subcontract", "labor"… The chart of accounts
   * answers it outright, so it is asked first, and it disagrees with the name both ways.
   *
   * Live examples of the two mistakes: "60400 Bank Services Charges" and
   * "51901 Permits & City Fees" are Classification "Expense" and match no keyword, so
   * they were skipped; an income account with "Expenses" in its name matched every time.
   */
  describe('deciding which journal lines are cost', () => {
    const chart = buildAccountIndex([
      { Id: '1150040003', Name: '60400 Bank Services Charges', Classification: 'Expense' },
      { Id: '77', Name: 'Reimbursed Expenses', Classification: 'Revenue' },
    ]);

    it('counts a cost account whose name does not look like one', () => {
      const { ctx } = harness();
      const entry = txn({
        entityType: 'JournalEntry',
        totalAmount: null,
        lineItems: [
          line({
            amount: 300,
            account: { value: '1150040003', name: '60400 Bank Services Charges' },
          }),
        ],
      });

      const result = allocateJournalEntryEngine(
        ctx,
        je([{ amount: 300, account: '60400 Bank Services Charges', posting: 'Debit' }]),
        entry,
        project,
        false,
        chart,
      );

      expect(result.amount).toBe(300);
    });

    it('skips an income account that merely has "Expenses" in its name', () => {
      const { ctx } = harness();
      const entry = txn({
        entityType: 'JournalEntry',
        totalAmount: null,
        lineItems: [line({ amount: 300, account: { value: '77', name: 'Reimbursed Expenses' } })],
      });

      const result = allocateJournalEntryEngine(
        ctx,
        je([{ amount: 300, account: 'Reimbursed Expenses', posting: 'Debit' }]),
        entry,
        project,
        false,
        chart,
      );

      expect(result.amount).toBe(0);
      expect(result.method).toBe('journal_not_explicit_cost');
    });

    /**
     * And with no chart to ask, the name heuristic is still the answer — not "no". Letting
     * an outage drop every journal adjustment from every job is the wrong way to be wrong.
     */
    it('falls back to the account name when the chart could not be read', () => {
      const { ctx } = harness();
      const entry = txn({
        entityType: 'JournalEntry',
        totalAmount: null,
        lineItems: [line({ amount: 300, account: { value: '1', name: 'Job Expense' } })],
      });

      const result = allocateJournalEntryEngine(
        ctx,
        je([{ amount: 300, account: 'Job Expense', posting: 'Debit' }]),
        entry,
        project,
        false,
        unknownAccountIndex,
      );

      expect(result.amount).toBe(300);
    });
  });

  it('ignores a trailing subtotal with no line after it', () => {
    const { ctx } = harness();
    const entry = txn({
      entityType: 'JournalEntry',
      totalAmount: null,
      lineItems: [line({ amount: 100, account: { value: '1', name: 'Labor' } })],
    });

    const result = allocateJournalEntryEngine(
      ctx,
      je([
        { amount: 100, account: 'Labor', posting: 'Debit' },
        { amount: 100, account: '', posting: '', detailType: 'SubTotalLineDetail' },
      ]),
      entry,
      project,
      false,
      unknownAccountIndex,
    );

    expect(result.amount).toBe(100);
    expect(result.details).toHaveLength(1);
  });

  it('skips journal lines belonging to another job', () => {
    const { ctx } = harness();
    const entry = txn({
      entityType: 'JournalEntry',
      totalAmount: null,
      lineItems: [
        line({ amount: 100, account: { value: '1', name: 'Labor' }, projectRefs: [onProject] }),
        line({ amount: 400, account: { value: '1', name: 'Labor' }, projectRefs: [onOtherJob] }),
      ],
    });

    const result = allocateJournalEntryEngine(
      ctx,
      je([
        { amount: 100, account: 'Labor', posting: 'Debit' },
        { amount: 400, account: 'Labor', posting: 'Debit' },
      ]),
      entry,
      project,
      true,
      unknownAccountIndex,
    );

    expect(result.amount).toBe(100);
  });
});

describe('paymentAllocationLinesEngine', () => {
  it('uses the payment lines that carry a linked transaction', () => {
    const { ctx } = harness();

    const lines = paymentAllocationLinesEngine(
      ctx,
      {
        Line: [
          { Amount: 300, LinkedTxn: [{ TxnId: '10', TxnType: 'Bill' }] },
          { Amount: 50 },
        ],
      },
      txn({ totalAmount: 350 }),
    );

    expect(lines).toEqual([{ amount: 300, linkedTxn: [{ txnId: '10', txnType: 'Bill' }] }]);
  });

  it('falls back to the header total when no line carries a link', () => {
    const { ctx } = harness();

    const lines = paymentAllocationLinesEngine(
      ctx,
      { LinkedTxn: [{ TxnId: '10', TxnType: 'Bill' }] },
      txn({ totalAmount: 700 }),
    );

    expect(lines).toEqual([{ amount: 700, linkedTxn: [{ txnId: '10', txnType: 'Bill' }] }]);
  });

  /** Better no line at all than a line worth zero, which would read as a payment of nothing. */
  it('returns nothing when there is neither a line nor a known total', () => {
    const { ctx } = harness();

    expect(paymentAllocationLinesEngine(ctx, {}, txn({ totalAmount: null }))).toEqual([]);
  });
});
