import { QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import { QuickbooksJobCostingService } from './quickbooks-job-costing.service';

describe('QuickbooksJobCostingService batch summaries', () => {
  it('fetches costs once and preserves per-project line and bill allocations', async () => {
    const customers = [
      { Id: 'job-1', DisplayName: 'P-1', Job: true },
      { Id: 'job-2', DisplayName: 'P-2', Job: true },
    ];
    const entities: Record<string, unknown[]> = {
      Customer: customers,
      Purchase: [
        {
          Id: 'purchase-1',
          TotalAmt: 100,
          PaymentType: 'Check',
          CustomerRef: { value: 'job-1', name: 'P-1' },
          Line: [
            {
              Amount: 40,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'expense', name: 'Expense' },
                CustomerRef: { value: 'job-1', name: 'P-1' },
              },
            },
            {
              Amount: 60,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'expense', name: 'Expense' },
                CustomerRef: { value: 'job-2', name: 'P-2' },
              },
            },
          ],
        },
      ],
      Bill: [
        {
          Id: 'bill-1',
          TotalAmt: 100,
          Balance: 20,
          CustomerRef: { value: 'job-1', name: 'P-1' },
          Line: [
            {
              Amount: 60,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'expense', name: 'Expense' },
                CustomerRef: { value: 'job-1', name: 'P-1' },
              },
            },
            {
              Amount: 40,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'expense', name: 'Expense' },
                CustomerRef: { value: 'job-2', name: 'P-2' },
              },
            },
          ],
        },
      ],
      VendorCredit: [
        {
          Id: 'credit-1',
          TotalAmt: 5,
          CustomerRef: { value: 'job-1', name: 'P-1' },
          Line: [
            {
              Amount: 5,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'expense', name: 'Expense' },
                CustomerRef: { value: 'job-1', name: 'P-1' },
              },
            },
          ],
        },
      ],
      PurchaseOrder: [
        {
          Id: 'po-1',
          TotalAmt: 7,
          CustomerRef: { value: 'job-1', name: 'P-1' },
          Line: [
            {
              Amount: 7,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: 'expense', name: 'Expense' },
                CustomerRef: { value: 'job-1', name: 'P-1' },
              },
            },
          ],
        },
      ],
      BillPayment: [],
      JournalEntry: [],
    };
    const queryAll = jest.fn(
      async (_realmId: string, entity: string) => entities[entity] ?? [],
    );
    const api = {
      queryAll,
      buildDateWhereClause: jest.fn(() => ({ where: undefined })),
    };
    const service = new QuickbooksJobCostingService(
      api as never,
      new QuickbooksNormalizerService(),
      { getDefaultRealmId: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const summaries = await service.getProjectJobCostSummaries(
      ['P-1', 'P-2', 'P-1'],
      'realm-1',
    );

    expect(summaries.get('P-1')).toMatchObject({
      cashOutPaid: 40,
      openAp: 12,
      vendorCredits: 5,
      committedPo: 7,
      totalJobCost: 47,
    });
    expect(summaries.get('P-2')).toMatchObject({
      cashOutPaid: 60,
      openAp: 8,
      vendorCredits: 0,
      committedPo: 0,
      totalJobCost: 68,
    });
    for (const entity of [
      'Purchase',
      'Bill',
      'BillPayment',
      'VendorCredit',
      'PurchaseOrder',
      'JournalEntry',
    ]) {
      expect(
        queryAll.mock.calls.filter(
          ([, queriedEntity]) => queriedEntity === entity,
        ),
      ).toHaveLength(1);
    }
  });
});
