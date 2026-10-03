import {
  AllocationContext,
  allocateBillOpenApEngine,
  allocateBillPaymentEngine,
  allocateJournalEntryEngine,
  allocateTransactionToProjectEngine,
  paymentAllocationLinesEngine,
} from './quickbooks-job-costing-allocation.engine';
import { QuickbooksJobCostingUtils } from './quickbooks-job-costing.utils';
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
  ) {
    return allocateTransactionToProjectEngine(this.ctx, txn, project, requireProjectMatch);
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

    const result = allocateTransactionToProjectEngine(ctx, txn({ totalAmount: 1200.5 }), project, false);

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

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

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

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

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

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

    expect(result.amount).toBe(500);
  });

  it('falls back to the whole transaction when only the header names the project', () => {
    const { ctx } = harness();
    const bill = txn({
      totalAmount: 800,
      projectRefs: [onProject],
      lineItems: [line({ amount: 800 })],
    });

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

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

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

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

    const result = allocateTransactionToProjectEngine(ctx, txn({ totalAmount: null }), project, false);

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

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

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

    const result = allocateTransactionToProjectEngine(ctx, purchase2792, baseJob, true);

    expect(result.amount).toBe(500);
    expect(result.details).toHaveLength(1);
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

    const result = allocateTransactionToProjectEngine(ctx, bill, project, true);

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

    const result = allocateTransactionToProjectEngine(ctx, bill, unresolved, true);

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

    const result = allocateBillOpenApEngine(ctx, bill, project, true);

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

    const result = allocateBillOpenApEngine(ctx, bill, project, true);

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

    const result = allocateBillOpenApEngine(ctx, bill, project, true);

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
    );

    expect(result.amount).toBe(500);
    expect(result.method).toBe('linked_bill_full');
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
    );

    expect(result.amount).toBe(500);
    expect(result.details).toHaveLength(2);
    // The regression: the line after the subtotal used to be pushed twice, so this was
    // 900 across three details and the job was charged for 400 it never incurred.
    expect(result.details.map((detail) => detail.allocatedAmount)).toEqual([100, 400]);
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
