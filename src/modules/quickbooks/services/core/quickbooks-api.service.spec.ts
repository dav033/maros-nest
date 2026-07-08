import axios, { AxiosError, AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { QuickbooksApiService } from './quickbooks-api.service';
import { QuickbooksAuthService } from './quickbooks-auth.service';
import { QBO_MAX_CONCURRENCY } from './quickbooks-concurrency.utils';

describe('QuickbooksApiService', () => {
  let service: QuickbooksApiService;
  let authService: jest.Mocked<QuickbooksAuthService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    authService = {
      getValidAccessToken: jest.fn().mockResolvedValue('token'),
      refreshTokens: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<QuickbooksAuthService>;
    configService = {
      get: jest.fn().mockReturnValue('sandbox'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new QuickbooksApiService(authService, configService);
  });

  afterEach(() => {
    service.clearReadCache();
    jest.restoreAllMocks();
  });

  describe('queryAll', () => {
    function mockFetchQueryPage(
      pageSizes: Record<number, number>,
      onCall?: (startPosition: number) => void,
    ): jest.SpyInstance {
      return jest
        .spyOn(
          service as unknown as {
            fetchQueryPage: (...args: unknown[]) => Promise<unknown[]>;
          },
          'fetchQueryPage',
        )
        .mockImplementation(
          (
            _realmId: string,
            _entityName: string,
            _selectClause: string,
            _where: string,
            _orderBy: string,
            startPosition: number,
            pageSize: number,
          ) => {
            onCall?.(startPosition);
            const size = pageSizes[startPosition] ?? pageSize;
            return Promise.resolve(
              Array.from({ length: size }, (_, i) => ({
                id: startPosition + i,
              })),
            );
          },
        ) as jest.SpyInstance;
    }

    it('returns the first page when it is partial', async () => {
      mockFetchQueryPage({ 1: 500 });

      const result = await service.queryAll('realm-1', 'Invoice');

      expect(result).toHaveLength(500);
    });

    it('stops launching new batches after a partial page is returned', async () => {
      const pageSizes: Record<number, number> = {
        1: 1000,
        1001: 1000,
        2001: 500,
        3001: 1000,
        4001: 1000,
      };
      const calls: number[] = [];
      mockFetchQueryPage(pageSizes, (startPosition) => calls.push(startPosition));

      const result = await service.queryAll('realm-1', 'Invoice');

      expect(calls).toContain(1);
      expect(calls).toContain(1001);
      expect(calls).toContain(2001);
      expect(calls).toContain(3001);
      expect(calls).not.toContain(4001);
      expect(result).toHaveLength(2500);
    });

    it('respects the maxPages option', async () => {
      const pageSizes: Record<number, number> = {
        1: 1000,
        1001: 1000,
        2001: 1000,
        3001: 1000,
      };
      const calls: number[] = [];
      mockFetchQueryPage(pageSizes, (startPosition) => calls.push(startPosition));

      await service.queryAll('realm-1', 'Invoice', { maxPages: 2 });

      expect(calls).toEqual([1, 1001]);
    });

    it('caps unbounded maxPages to the default page limit', async () => {
      const calls: number[] = [];
      mockFetchQueryPage(
        {},
        (startPosition) => calls.push(startPosition),
      ).mockImplementation(
        (
          _realmId: string,
          _entityName: string,
          _selectClause: string,
          _where: string,
          _orderBy: string,
          startPosition: number,
          pageSize: number,
        ) => {
          calls.push(startPosition);
          return Promise.resolve(
            Array.from({ length: pageSize }, (_, i) => ({ id: startPosition + i })),
          );
        },
      );

      await service.queryAll('realm-1', 'Invoice');

      const maxStartPosition = Math.max(...calls);
      expect(calls).toHaveLength(50);
      expect(maxStartPosition).toBe(1 + 1000 * 49);
    });

    it('limits concurrent page fetches to QBO_MAX_CONCURRENCY', async () => {
      let running = 0;
      let maxRunning = 0;
      const deferreds: Array<{
        resolve: (value: unknown[]) => void;
        reject: (reason?: unknown) => void;
      }> = [];

      jest
        .spyOn(
          service as unknown as {
            fetchQueryPage: (...args: unknown[]) => Promise<unknown[]>;
          },
          'fetchQueryPage',
        )
        .mockImplementation(
          (
            _realmId: string,
            _entityName: string,
            _selectClause: string,
            _where: string,
            _orderBy: string,
            startPosition: number,
            pageSize: number,
          ) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            return new Promise<unknown[]>((resolve) => {
              deferreds.push({
                resolve: () => {
                  running -= 1;
                  resolve(
                    Array.from({ length: pageSize }, (_, i) => ({
                      id: startPosition + i,
                    })),
                  );
                },
              });
            });
          },
        );

      const promise = service.queryAll('realm-1', 'Invoice', { maxPages: 5 });

      const interval = setInterval(() => {
        while (deferreds.length > 0) {
          const deferred = deferreds.shift();
          deferred?.resolve([]);
        }
      }, 5);

      await promise;
      clearInterval(interval);

      expect(maxRunning).toBeLessThanOrEqual(QBO_MAX_CONCURRENCY);
    });

    it('always includes realmId in the cache key and treats options.cacheKey as a suffix', async () => {
      const fetchSpy = mockFetchQueryPage({ 1: 1 });

      const resultA = await service.queryAll('realm-a', 'Invoice', { cacheKey: 'custom' });
      const resultB = await service.queryAll('realm-b', 'Invoice', { cacheKey: 'custom' });
      const cachedA = await service.queryAll('realm-a', 'Invoice', { cacheKey: 'custom' });
      const cachedB = await service.queryAll('realm-b', 'Invoice', { cacheKey: 'custom' });

      expect(resultA).toEqual([{ id: 1 }]);
      expect(resultB).toEqual([{ id: 1 }]);
      expect(cachedA).toBe(resultA);
      expect(cachedB).toBe(resultB);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('includes a normalized default maxPages value so undefined and the default share a key', async () => {
      const fetchSpy = mockFetchQueryPage({ 1: 1 });

      await service.queryAll('realm-1', 'Invoice');
      await service.queryAll('realm-1', 'Invoice', { maxPages: 50 });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('queryRawGet', () => {
    it('logs the exact query and QBO response on 400 Bad Request', async () => {
      const axiosError = Object.assign(new Error('Bad Request') as AxiosError, {
        isAxiosError: true,
      });
      axiosError.response = {
        status: 400,
        data: {
          Fault: {
            Error: [{ Message: 'Invalid field Name in SELECT clause' }],
          },
        },
      } as unknown as typeof axiosError.response;

      jest.spyOn(axios, 'create').mockReturnValue({
        get: jest.fn().mockRejectedValue(axiosError),
      } as unknown as AxiosInstance);

      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(
        service.queryRawGet('realm-1', 'SELECT Name FROM Customer'),
      ).rejects.toThrow('Bad Request');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'QBO query failed with 400: SELECT Name FROM Customer',
        ),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid field Name in SELECT clause'),
      );
    });

    it('does not log on non-400 errors', async () => {
      const axiosError = Object.assign(new Error('Server Error') as AxiosError, {
        isAxiosError: true,
      });
      axiosError.response = {
        status: 500,
        data: { Fault: { Error: [{ Message: 'Internal Server Error' }] } },
      } as unknown as typeof axiosError.response;

      jest.spyOn(axios, 'create').mockReturnValue({
        get: jest.fn().mockRejectedValue(axiosError),
      } as unknown as AxiosInstance);

      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(
        service.queryRawGet('realm-1', 'SELECT * FROM Invoice'),
      ).rejects.toThrow('Server Error');

      expect(loggerSpy).not.toHaveBeenCalled();
    });
  });

  describe('queryRawPost', () => {
    it('logs the exact query and QBO response on 400 Bad Request', async () => {
      const axiosError = Object.assign(new Error('Bad Request') as AxiosError, {
        isAxiosError: true,
      });
      axiosError.response = {
        status: 400,
        data: {
          Fault: {
            Error: [{ Message: 'Invalid field Name in SELECT clause' }],
          },
        },
      } as unknown as typeof axiosError.response;

      jest.spyOn(axios, 'create').mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as unknown as AxiosInstance);

      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(
        service.queryRawPost('realm-1', 'SELECT Name FROM Customer'),
      ).rejects.toThrow('Bad Request');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'QBO query failed with 400: SELECT Name FROM Customer',
        ),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid field Name in SELECT clause'),
      );
    });

    it('does not log on non-400 errors', async () => {
      const axiosError = Object.assign(new Error('Server Error') as AxiosError, {
        isAxiosError: true,
      });
      axiosError.response = {
        status: 500,
        data: { Fault: { Error: [{ Message: 'Internal Server Error' }] } },
      } as unknown as typeof axiosError.response;

      jest.spyOn(axios, 'create').mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as unknown as AxiosInstance);

      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(
        service.queryRawPost('realm-1', 'SELECT * FROM Invoice'),
      ).rejects.toThrow('Server Error');

      expect(loggerSpy).not.toHaveBeenCalled();
    });
  });

  describe('escapeQboLike', () => {
    it('escapes single quotes, percent signs, and underscores', () => {
      expect(service.escapeQboLike("it's 100% done_")).toBe(
        "it''s 100\\% done\\_",
      );
    });

    it('escapes backslashes before percent and underscore to avoid generating wildcards', () => {
      expect(service.escapeQboLike('\\_')).toBe('\\\\\\_');
      expect(service.escapeQboLike('A\\\\B')).toBe('A\\\\\\\\B');
    });
  });
});
