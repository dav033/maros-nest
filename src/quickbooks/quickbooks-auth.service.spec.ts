import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import axios from 'axios';
import { QuickbooksAuthService } from './services/quickbooks-auth.service';
import { TokenCryptoService } from './services/token-crypto.service';
import { QboConnection } from './entities/qbo-connection.entity';
import { QboReauthorizationRequiredException } from './exceptions/qbo-reauthorization-required.exception';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REALM_ID = 'test-realm-123';
const PLAIN_ACCESS = 'plain-access-token';
const PLAIN_REFRESH = 'plain-refresh-token';
const ENC_ACCESS = 'enc:access';
const ENC_REFRESH = 'enc:refresh';

function makeConnection(overrides: Partial<QboConnection> = {}): QboConnection {
  return {
    realmId: REALM_ID,
    accessToken: ENC_ACCESS,
    refreshToken: ENC_REFRESH,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickbooksAuthService', () => {
  let service: QuickbooksAuthService;
  let repo: jest.Mocked<Repository<QboConnection>>;
  let crypto: jest.Mocked<TokenCryptoService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuickbooksAuthService,
        {
          provide: getRepositoryToken(QboConnection),
          useValue: {
            findOneBy: jest.fn(),
            upsert: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const map: Record<string, string> = {
                QB_CLIENT_ID: 'test-client-id',
                QB_SECRET_KEY: 'test-secret',
                QB_REDIRECT_URI: 'https://example.com/quickbooks/callback',
              };
              return map[key];
            }),
            get: jest.fn(),
          },
        },
        {
          provide: TokenCryptoService,
          useValue: {
            encrypt: jest.fn((v: string) => `enc:${v}`),
            decrypt: jest.fn((v: string) => v.replace('enc:', '')),
          },
        },
      ],
    }).compile();

    service = module.get(QuickbooksAuthService);
    repo = module.get(getRepositoryToken(QboConnection));
    crypto = module.get(TokenCryptoService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // getAuthorizationUrl
  // -------------------------------------------------------------------------

  describe('getAuthorizationUrl', () => {
    it('includes all required OAuth 2.0 parameters', () => {
      const url = service.getAuthorizationUrl('my-state');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('scope=com.intuit.quickbooks.accounting');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=my-state');
      expect(url).toContain('redirect_uri=');
    });
  });

  // -------------------------------------------------------------------------
  // exchangeCodeForTokens
  // -------------------------------------------------------------------------

  describe('exchangeCodeForTokens', () => {
    it('POSTs to the token endpoint with Basic auth and stores encrypted tokens', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          access_token: PLAIN_ACCESS,
          refresh_token: PLAIN_REFRESH,
          expires_in: 3600,
          token_type: 'bearer',
        },
      });

      await service.exchangeCodeForTokens('auth-code', REALM_ID);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        expect.stringContaining('grant_type=authorization_code'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          realmId: REALM_ID,
          accessToken: `enc:${PLAIN_ACCESS}`,
          refreshToken: `enc:${PLAIN_REFRESH}`,
        }),
        ['realmId'],
      );
    });
  });

  // -------------------------------------------------------------------------
  // refreshTokens
  // -------------------------------------------------------------------------

  describe('refreshTokens', () => {
    it('decrypts stored refresh_token, calls Intuit, and saves the new tokens', async () => {
      repo.findOneBy.mockResolvedValue(makeConnection());
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'bearer',
        },
      });

      await service.refreshTokens(REALM_ID);

      // Must have decrypted the stored refresh token
      expect(crypto.decrypt).toHaveBeenCalledWith(ENC_REFRESH);

      // Must persist the NEW refresh token (rotation)
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: 'enc:new-refresh',
          accessToken: 'enc:new-access',
        }),
        ['realmId'],
      );
    });

    it('throws QboReauthorizationRequiredException when Intuit returns invalid_grant', async () => {
      repo.findOneBy.mockResolvedValue(makeConnection());
      mockedAxios.post = jest.fn().mockRejectedValue({
        response: { data: { error: 'invalid_grant' } },
      });

      await expect(service.refreshTokens(REALM_ID)).rejects.toThrow(
        QboReauthorizationRequiredException,
      );
    });

    it('throws QboReauthorizationRequiredException when no connection exists', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.refreshTokens(REALM_ID)).rejects.toThrow(
        QboReauthorizationRequiredException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getValidAccessToken
  // -------------------------------------------------------------------------

  describe('getValidAccessToken', () => {
    it('returns decrypted access_token when it is not expiring soon', async () => {
      repo.findOneBy.mockResolvedValue(makeConnection()); // expires in 1 hour

      const token = await service.getValidAccessToken(REALM_ID);

      expect(token).toBe(PLAIN_ACCESS);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('refreshes and returns new token when expiry is within 5 minutes', async () => {
      const expiringSoon = makeConnection({
        expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 min from now
      });
      const afterRefresh = makeConnection({
        accessToken: 'enc:fresh-access',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      repo.findOneBy
        .mockResolvedValueOnce(expiringSoon)  // initial read
        .mockResolvedValueOnce(afterRefresh); // read after refresh

      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 3600,
          token_type: 'bearer',
        },
      });

      const token = await service.getValidAccessToken(REALM_ID);

      expect(mockedAxios.post).toHaveBeenCalled();
      expect(token).toBe('fresh-access');
    });
  });
});

// ---------------------------------------------------------------------------
// TokenCryptoService
// ---------------------------------------------------------------------------

describe('TokenCryptoService', () => {
  let cryptoService: TokenCryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenCryptoService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(
              // 64 hex chars = 32 bytes — deterministic test key
              'a'.repeat(64),
            ),
          },
        },
      ],
    }).compile();

    cryptoService = module.get(TokenCryptoService);
    cryptoService.onModuleInit();
  });

  it('encrypt → decrypt roundtrip returns the original plaintext', () => {
    const original = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.payload.signature';
    const encrypted = cryptoService.encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(cryptoService.decrypt(encrypted)).toBe(original);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const plain = 'same-token';
    const c1 = cryptoService.encrypt(plain);
    const c2 = cryptoService.encrypt(plain);
    expect(c1).not.toBe(c2);
    expect(cryptoService.decrypt(c1)).toBe(plain);
    expect(cryptoService.decrypt(c2)).toBe(plain);
  });

  it('throws on tampered ciphertext (GCM auth tag verification)', () => {
    const encrypted = cryptoService.encrypt('secret');
    const tampered = encrypted.slice(0, -4) + 'dead';
    expect(() => cryptoService.decrypt(tampered)).toThrow();
  });

  it('rejects invalid key length on init', () => {
    const badModule = Test.createTestingModule({
      providers: [
        TokenCryptoService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('short') },
        },
      ],
    }).compile();

    return badModule.then((m) => {
      const svc = m.get(TokenCryptoService);
      expect(() => svc.onModuleInit()).toThrow('64 hex characters');
    });
  });
});
