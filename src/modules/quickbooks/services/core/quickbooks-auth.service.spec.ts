import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QuickbooksAuthService } from './quickbooks-auth.service';
import { TokenCryptoService } from './token-crypto.service';

describe('QuickbooksAuthService', () => {
  let service: QuickbooksAuthService;
  let connectionRepo: jest.Mocked<Repository<QboConnection>>;
  let configService: jest.Mocked<ConfigService>;
  let tokenCrypto: TokenCryptoService;
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    connectionRepo = {
      findOneBy: jest.fn(),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Repository<QboConnection>>;

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'QB_CLIENT_ID') return 'client-id';
        if (key === 'QB_SECRET_KEY') return 'client-secret';
        if (key === 'QB_REDIRECT_URI') return 'http://localhost/callback';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    tokenCrypto = new TokenCryptoService(configService);

    service = new QuickbooksAuthService(
      connectionRepo,
      configService,
      tokenCrypto,
    );

    postSpy = jest.spyOn(axios, 'post').mockImplementation(() => {
      // Tests override this as needed.
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('refreshTokens', () => {
    it('deduplicates concurrent refresh requests so only one Intuit call is made', async () => {
      const realmId = 'realm-1';
      const connection: QboConnection = {
        realmId,
        accessToken: 'encrypted-access',
        refreshToken: 'encrypted-refresh',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      connectionRepo.findOneBy.mockResolvedValue(connection);

      postSpy.mockResolvedValue({
        data: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const promiseA = service.refreshTokens(realmId);
      const promiseB = service.refreshTokens(realmId);
      const promiseC = service.refreshTokens(realmId);

      await Promise.all([promiseA, promiseB, promiseC]);

      expect(postSpy.mock.calls).toHaveLength(1);
      expect(connectionRepo.upsert.mock.calls).toHaveLength(1);
    });
  });

  describe('getValidAccessToken caching', () => {
    const realmId = 'realm-1';

    const connectionWith = (expiresAt: Date): QboConnection => ({
      realmId,
      accessToken: tokenCrypto.encrypt('stored-access'),
      refreshToken: tokenCrypto.encrypt('stored-refresh'),
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('reads the connection row once and serves later calls from memory', async () => {
      connectionRepo.findOneBy.mockResolvedValue(
        connectionWith(new Date(Date.now() + 3_600_000)),
      );

      const first = await service.getValidAccessToken(realmId);
      const second = await service.getValidAccessToken(realmId);
      const third = await service.getValidAccessToken(realmId);

      expect(first).toBe('stored-access');
      expect(second).toBe('stored-access');
      expect(third).toBe('stored-access');
      expect(connectionRepo.findOneBy.mock.calls).toHaveLength(1);
    });

    it('collapses a burst of concurrent cache misses into a single database read', async () => {
      connectionRepo.findOneBy.mockResolvedValue(
        connectionWith(new Date(Date.now() + 3_600_000)),
      );

      const tokens = await Promise.all(
        Array.from({ length: 20 }, () => service.getValidAccessToken(realmId)),
      );

      expect(tokens.every((t) => t === 'stored-access')).toBe(true);
      expect(connectionRepo.findOneBy.mock.calls).toHaveLength(1);
    });

    it('does not serve a token that is inside the expiry buffer; it refreshes once', async () => {
      // 60 s of life left, i.e. well inside EXPIRY_BUFFER_SECONDS (300 s).
      connectionRepo.findOneBy.mockResolvedValue(
        connectionWith(new Date(Date.now() + 60_000)),
      );
      postSpy.mockResolvedValue({
        data: {
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const token = await service.getValidAccessToken(realmId);
      expect(token).toBe('refreshed-access');
      expect(postSpy.mock.calls).toHaveLength(1);

      // The freshly minted token is now cached, so no further Intuit round trip.
      const again = await service.getValidAccessToken(realmId);
      expect(again).toBe('refreshed-access');
      expect(postSpy.mock.calls).toHaveLength(1);
    });

    it('serves the new token after a refresh instead of the stale cached one', async () => {
      connectionRepo.findOneBy.mockResolvedValue(
        connectionWith(new Date(Date.now() + 3_600_000)),
      );
      expect(await service.getValidAccessToken(realmId)).toBe('stored-access');

      postSpy.mockResolvedValue({
        data: {
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });
      await service.refreshTokens(realmId);

      expect(await service.getValidAccessToken(realmId)).toBe('rotated-access');
    });

    it('re-reads the row after invalidateAccessToken (the 401 path)', async () => {
      connectionRepo.findOneBy.mockResolvedValue(
        connectionWith(new Date(Date.now() + 3_600_000)),
      );

      await service.getValidAccessToken(realmId);
      expect(connectionRepo.findOneBy.mock.calls).toHaveLength(1);

      service.invalidateAccessToken(realmId);
      await service.getValidAccessToken(realmId);
      expect(connectionRepo.findOneBy.mock.calls).toHaveLength(2);
    });

    it('caches per realm and does not leak a token across realms', async () => {
      connectionRepo.findOneBy.mockImplementation((where: unknown) => {
        const { realmId: id } = where as { realmId: string };
        return Promise.resolve({
          realmId: id,
          accessToken: tokenCrypto.encrypt(`access-for-${id}`),
          refreshToken: tokenCrypto.encrypt('refresh'),
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as QboConnection);
      });

      expect(await service.getValidAccessToken('realm-a')).toBe(
        'access-for-realm-a',
      );
      expect(await service.getValidAccessToken('realm-b')).toBe(
        'access-for-realm-b',
      );
      expect(await service.getValidAccessToken('realm-a')).toBe(
        'access-for-realm-a',
      );
      expect(connectionRepo.findOneBy.mock.calls).toHaveLength(2);
    });

    it('caches the token minted by a fresh OAuth connect', async () => {
      postSpy.mockResolvedValue({
        data: {
          access_token: 'connected-access',
          refresh_token: 'connected-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      await service.exchangeCodeForTokens('code', realmId);

      expect(await service.getValidAccessToken(realmId)).toBe(
        'connected-access',
      );
      expect(connectionRepo.findOneBy).not.toHaveBeenCalled();
    });
  });
});
