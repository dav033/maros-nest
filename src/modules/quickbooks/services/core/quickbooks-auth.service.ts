import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { TokenCryptoService } from './token-crypto.service';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';

const TOKEN_ENDPOINT =
  'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZATION_ENDPOINT = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
/** Refresh the access token when it expires within this many seconds. */
const EXPIRY_BUFFER_SECONDS = 300;

interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds until access_token expires — Intuit always returns 3600. */
  expires_in: number;
  token_type: string;
}

@Injectable()
export class QuickbooksAuthService {
  private readonly logger = new Logger(QuickbooksAuthService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  /** Precomputed Basic auth header for token endpoint calls. */
  private readonly basicAuthHeader: string;

  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly configService: ConfigService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {
    this.clientId = this.configService.get<string>('QB_CLIENT_ID') ?? '';
    this.clientSecret = this.configService.get<string>('QB_SECRET_KEY') ?? '';
    this.redirectUri = this.configService.get<string>('QB_REDIRECT_URI') ?? '';
    this.basicAuthHeader =
      this.clientId && this.clientSecret
        ? `Basic ${Buffer.from(
            `${this.clientId}:${this.clientSecret}`,
          ).toString('base64')}`
        : '';
  }

  /**
   * Builds the Intuit OAuth 2.0 authorization URL.
   * @param state  Random opaque value — caller is responsible for CSRF validation.
   */
  getAuthorizationUrl(state: string): string {
    this.ensureOAuthConfigured();
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: QBO_SCOPE,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      state,
    });
    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchanges a one-time authorization code for access + refresh tokens
   * and persists them encrypted in the database (UPSERT by realmId).
   */
  async exchangeCodeForTokens(code: string, realmId: string): Promise<void> {
    this.ensureOAuthConfigured();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });

    const { data } = await axios.post<QboTokenResponse>(
      TOKEN_ENDPOINT,
      body.toString(),
      { headers: this.tokenRequestHeaders() },
    );

    await this.persistTokens(realmId, data);
    this.logger.log(`QBO tokens exchanged and stored for realm ${realmId}`);
  }

  /**
   * Refreshes tokens for the given realmId using the stored refresh_token.
   * IMPORTANT: Intuit rotates the refresh_token on every call — the new value
   * is always saved, even if it looks the same.
   */
  async refreshTokens(realmId: string): Promise<void> {
    this.ensureOAuthConfigured();
    const connection = await this.connectionRepo.findOneBy({ realmId });
    if (!connection) {
      throw new QboReauthorizationRequiredException(realmId);
    }

    const currentRefreshToken = this.tokenCrypto.decrypt(
      connection.refreshToken,
    );

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken,
      });

      const { data } = await axios.post<QboTokenResponse>(
        TOKEN_ENDPOINT,
        body.toString(),
        { headers: this.tokenRequestHeaders() },
      );

      await this.persistTokens(realmId, data);
      this.logger.log(`QBO tokens refreshed successfully for realm ${realmId}`);
    } catch (error: unknown) {
      const errData = (error as { response?: { data?: { error?: string } } })
        .response?.data;

      if (errData?.error === 'invalid_grant') {
        this.logger.error(
          `QBO invalid_grant for realm ${realmId} — manual reauthorization required`,
        );
        throw new QboReauthorizationRequiredException(realmId);
      }

      this.logger.error(
        `QBO token refresh failed for realm ${realmId}: ${String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Returns a valid (non-expired) access token, refreshing transparently if
   * the stored token expires within EXPIRY_BUFFER_SECONDS.
   */
  async getValidAccessToken(realmId: string): Promise<string> {
    const connection = await this.connectionRepo.findOneBy({ realmId });
    if (!connection) {
      throw new QboReauthorizationRequiredException(realmId);
    }

    const bufferMs = EXPIRY_BUFFER_SECONDS * 1000;
    const isExpiringSoon =
      connection.expiresAt.getTime() - Date.now() < bufferMs;

    if (isExpiringSoon) {
      await this.refreshTokens(realmId);
      const refreshed = await this.connectionRepo.findOneBy({ realmId });
      return this.tokenCrypto.decrypt(refreshed!.accessToken);
    }

    return this.tokenCrypto.decrypt(connection.accessToken);
  }

  // ---------------------------------------------------------------------------

  private async persistTokens(
    realmId: string,
    tokens: QboTokenResponse,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await this.connectionRepo.upsert(
      {
        realmId,
        accessToken: this.tokenCrypto.encrypt(tokens.access_token),
        refreshToken: this.tokenCrypto.encrypt(tokens.refresh_token),
        expiresAt,
      },
      ['realmId'],
    );
  }

  private tokenRequestHeaders(): Record<string, string> {
    this.ensureOAuthConfigured();
    return {
      Authorization: this.basicAuthHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
  }

  private ensureOAuthConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error('QuickBooks OAuth is not configured.');
    }
  }
}
