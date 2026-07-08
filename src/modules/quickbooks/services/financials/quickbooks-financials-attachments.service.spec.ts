import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import { QuickbooksFinancialsAttachmentsService } from './quickbooks-financials-attachments.service';
import { QBO_ATTACHMENT_CONCURRENCY } from '../core/quickbooks-concurrency.utils';

describe('QuickbooksFinancialsAttachmentsService', () => {
  let service: QuickbooksFinancialsAttachmentsService;
  let apiService: jest.Mocked<
    Pick<QuickbooksApiService, 'queryAll' | 'escapeQboString'>
  >;

  beforeEach(() => {
    apiService = {
      queryAll: jest.fn(),
      escapeQboString: jest.fn().mockImplementation((value: string) => value),
    };

    service = new QuickbooksFinancialsAttachmentsService(
      apiService as unknown as QuickbooksApiService,
      new QuickbooksNormalizerService(),
    );
  });

  describe('getAttachablesForEntityRefs', () => {
    it('fetches attachments for each unique entity ref with bounded concurrency', async () => {
      let running = 0;
      let maxRunning = 0;
      const deferreds: Array<{
        entityType: string;
        entityId: string;
        resolve: (value: Record<string, unknown>[]) => void;
      }> = [];

      apiService.queryAll.mockImplementation(
        async (_realmId: string, entityName: string, options: { where?: string }) => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);

          const match = options.where?.match(/Type = '([^']+)'.*Value = '([^']+)'/);
          const entityType = match?.[1] ?? entityName;
          const entityId = match?.[2] ?? '';

          return new Promise<Record<string, unknown>[]>((resolve) => {
            deferreds.push({ entityType, entityId, resolve });
          }).finally(() => {
            running -= 1;
          });
        },
      );

      const refs = Array.from({ length: 10 }, (_, i) => ({
        entityType: 'Invoice',
        entityId: `inv-${i}`,
      }));

      const promise = service.getAttachablesForEntityRefs('realm-1', refs);

      const interval = setInterval(() => {
        while (deferreds.length > 0) {
          const deferred = deferreds.shift();
          deferred?.resolve([
            { Id: `${deferred.entityType}-${deferred.entityId}-att` },
          ]);
        }
      }, 5);

      const result = await promise;
      clearInterval(interval);

      expect(maxRunning).toBeLessThanOrEqual(QBO_ATTACHMENT_CONCURRENCY);
      expect(result).toHaveLength(refs.length);
    });

    it('deduplicates entity refs before fetching attachments', async () => {
      apiService.queryAll.mockResolvedValue([]);

      await service.getAttachablesForEntityRefs('realm-1', [
        { entityType: 'Invoice', entityId: 'inv-1' },
        { entityType: 'Invoice', entityId: 'inv-1' },
        { entityType: 'Invoice', entityId: 'inv-2' },
      ]);

      expect(apiService.queryAll).toHaveBeenCalledTimes(2);
    });
  });
});
