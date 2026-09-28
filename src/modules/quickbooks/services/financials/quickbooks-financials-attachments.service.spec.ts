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

    it('never asks Attachable for TxnDate, a property QBO does not expose', async () => {
      apiService.queryAll.mockResolvedValue([]);

      await service.getAttachablesForEntityRefs('realm-1', [
        { entityType: 'Invoice', entityId: 'inv-1' },
      ]);

      const options = apiService.queryAll.mock.calls[0][2] as {
        select?: string;
        where?: string;
      };
      expect(options.select).toBe('Id, FileName, ContentType, Size, Note, AttachableRef');
      expect(options.select).not.toContain('TxnDate');
      expect(options.where).not.toContain(' OR ');
      expect(options.where).not.toContain('(');
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

  describe('getProjectRelatedEntityRefs', () => {
    /**
     * Properties QuickBooks refuses to project for each entity (verified
     * against the live API: 400 "Property X not found for Entity Y").
     */
    const REJECTED: Record<string, string[]> = {
      Estimate: ['Memo'],
      Invoice: ['Memo'],
      Payment: ['Memo', 'CustomerMemo'],
      Purchase: ['Memo', 'CustomerMemo', 'CustomerRef', 'LinkedTxn'],
    };

    it('only projects properties QuickBooks accepts for each entity', async () => {
      apiService.queryAll.mockResolvedValue([]);

      await service.getProjectRelatedEntityRefs('realm-1', '001-0924', 'job-1');

      for (const call of apiService.queryAll.mock.calls) {
        const entity = call[1];
        const select = (call[2] as { select?: string })?.select;
        if (!select || !REJECTED[entity]) continue;
        const fields = select.split(',').map((field) => field.trim());
        for (const property of REJECTED[entity]) {
          expect(fields).not.toContain(property);
        }
      }
    });
  });
});
