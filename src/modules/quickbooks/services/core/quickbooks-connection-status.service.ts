import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QboConnection } from '../../entities/qbo-connection.entity';
import { QuickbooksAuthService } from './quickbooks-auth.service';

export type QuickbooksConnectionStatus = {
  connected: boolean;
  realmId: string | null;
  oauthConfigured: boolean;
  accessTokenExpiresAt: string | null;
  accessTokenExpiresInSeconds: number | null;
  accessTokenExpired: boolean;
  /** Tokens rotate on every refresh, so this is the last successful refresh. */
  lastRefreshedAt: string | null;
  connectedAt: string | null;
  /** Where an admin has to go to reauthorize, relative to the API base URL. */
  authorizationUrl: string;
  checkedAt: string;
};

@Injectable()
export class QuickbooksConnectionStatusService {
  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly authService: QuickbooksAuthService,
  ) {}

  /**
   * Reads the stored connection only — no QuickBooks call — so a settings card
   * can poll it without spending API quota. `connected` therefore means
   * "credentials are on file", not "Intuit accepted them a second ago": a
   * refresh token revoked on Intuit's side only surfaces on the next real call,
   * as 503 QBO_REAUTHORIZATION_REQUIRED. `accessTokenExpired` is the readable
   * warning sign, since the refresh cron should never let that happen.
   */
  async getStatus(): Promise<QuickbooksConnectionStatus> {
    const [connection] = await this.connectionRepo.find({
      order: { updatedAt: 'DESC' },
      take: 1,
    });
    const now = Date.now();
    const expiresAt = connection?.expiresAt
      ? new Date(connection.expiresAt)
      : null;

    return {
      connected: Boolean(connection),
      realmId: connection?.realmId ?? null,
      oauthConfigured: this.authService.isOAuthConfigured(),
      accessTokenExpiresAt: expiresAt?.toISOString() ?? null,
      accessTokenExpiresInSeconds: expiresAt
        ? Math.round((expiresAt.getTime() - now) / 1000)
        : null,
      accessTokenExpired: expiresAt ? expiresAt.getTime() <= now : false,
      lastRefreshedAt: connection?.updatedAt
        ? new Date(connection.updatedAt).toISOString()
        : null,
      connectedAt: connection?.createdAt
        ? new Date(connection.createdAt).toISOString()
        : null,
      authorizationUrl: '/quickbooks/connect',
      checkedAt: new Date(now).toISOString(),
    };
  }
}
