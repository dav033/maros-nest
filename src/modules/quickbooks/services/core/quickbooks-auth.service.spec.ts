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
});
