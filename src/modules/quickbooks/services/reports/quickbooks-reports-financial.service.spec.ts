import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksReportsContextService } from './quickbooks-reports.context.service';
import { QuickbooksReportsFinancialService } from './quickbooks-reports-financial.service';
import { QBO_MAX_CONCURRENCY } from '../core/quickbooks-concurrency.utils';

describe('QuickbooksReportsFinancialService', () => {
  let service: QuickbooksReportsFinancialService;
  let apiService: jest.Mocked<Pick<QuickbooksApiService, 'report'>>;
  let contextService: jest.Mocked<Pick<QuickbooksReportsContextService, 'resolveRealmId'>>;

  beforeEach(() => {
    apiService = {
      report: jest.fn(),
    };
    contextService = {
      resolveRealmId: jest.fn().mockImplementation((realmId) => Promise.resolve(realmId ?? 'realm-1')),
    };

    service = new QuickbooksReportsFinancialService(
      apiService as unknown as QuickbooksApiService,
      contextService as unknown as QuickbooksReportsContextService,
    );
  });

  describe('getProfitAndLoss', () => {
    it('fetches date-range chunks in parallel with bounded concurrency', async () => {
      let running = 0;
      let maxRunning = 0;
      const deferreds: Array<{
        params: Record<string, string | number>;
        resolve: (value: unknown) => void;
      }> = [];

      apiService.report.mockImplementation(
        (_realmId: string, _reportName: string, params: Record<string, string | number>) => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          return new Promise<unknown>((resolve) => {
            deferreds.push({ params, resolve });
          }).finally(() => {
            running -= 1;
          });
        },
      );

      const promise = service.getProfitAndLoss({
        realmId: 'realm-1',
        startDate: '2022-01-01',
        endDate: '2024-12-31',
        accountingMethod: 'Accrual',
      });

      const interval = setInterval(() => {
        while (deferreds.length > 0) {
          const deferred = deferreds.shift();
          deferred?.resolve({
            Columns: { Column: [{ ColTitle: 'label' }, { ColTitle: 'amount' }] },
            Rows: {
              Row: [
                {
                  type: 'Data',
                  ColData: [{ value: 'Revenue' }, { value: '1000.00' }],
                },
              ],
            },
          });
        }
      }, 5);

      const result = await promise;
      clearInterval(interval);

      expect(maxRunning).toBeLessThanOrEqual(QBO_MAX_CONCURRENCY);
      expect(result.rows.length).toBeGreaterThan(QBO_MAX_CONCURRENCY);
    });

    it('continues processing remaining chunks when one chunk fails', async () => {
      let callCount = 0;
      apiService.report.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(new Error('QBO timeout'));
        }
        return Promise.resolve({
          Columns: { Column: [{ ColTitle: 'label' }, { ColTitle: 'amount' }] },
          Rows: {
            Row: [
              {
                type: 'Data',
                ColData: [{ value: 'Revenue' }, { value: '500.00' }],
              },
            ],
          },
        });
      });

      const result = await service.getProfitAndLoss({
        realmId: 'realm-1',
        startDate: '2022-01-01',
        endDate: '2023-12-31',
        accountingMethod: 'Accrual',
      });

      expect(result.rows.length).toBeGreaterThan(0);
      expect(apiService.report).toHaveBeenCalledTimes(4);
    });
  });
});
