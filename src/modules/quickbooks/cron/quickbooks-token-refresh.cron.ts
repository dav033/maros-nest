import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QboConnection } from '../entities/qbo-connection.entity';
import { QuickbooksAuthService } from '../services/core/quickbooks-auth.service';
import { QboReauthorizationRequiredException } from '../exceptions/qbo-reauthorization-required.exception';

/**
 * Refresh tokens expiring within this window.
 * Must be > cron interval (30 min) to guarantee the cron always catches
 * a token before it expires. QBO access tokens last exactly 60 minutes.
 * With a 35-min window and 30-min cron: worst case refresh is 5 min early.
 */
const EXPIRY_WINDOW_MINUTES = 35;

@Injectable()
export class QuickbooksTokenRefreshCron {
  private readonly logger = new Logger(QuickbooksTokenRefreshCron.name);

  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly authService: QuickbooksAuthService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Every 30 minutes: refresh connections whose access_token expires within
   * the next 10 minutes.  Keeps tokens always hot between health refreshes.
   */
  @Cron('*/30 * * * *')
  async refreshExpiringTokens(): Promise<void> {
    const threshold = new Date(Date.now() + EXPIRY_WINDOW_MINUTES * 60 * 1000);

    const expiring = await this.connectionRepo.findBy({
      expiresAt: LessThan(threshold),
    });

    if (expiring.length === 0) return;

    this.logger.log(
      `Found ${expiring.length} QBO connection(s) expiring within ${EXPIRY_WINDOW_MINUTES} min — refreshing`,
    );

    await Promise.allSettled(
      expiring.map((conn) => this.safeRefresh(conn.realmId)),
    );
  }

  /**
   * Every 12 hours: refresh ALL connections regardless of expiry.
   * Intuit's refresh_token has a 100-day sliding TTL but rotates on every use.
   * Refreshing every 12 h ensures it never goes stale even without API activity.
   */
  @Cron('0 */12 * * *')
  async healthRefreshAllConnections(): Promise<void> {
    const all = await this.connectionRepo.find();

    if (all.length === 0) return;

    this.logger.log(
      `Running 12h health refresh for ${all.length} QBO connection(s)`,
    );

    await Promise.allSettled(
      all.map((conn) => this.safeRefresh(conn.realmId)),
    );
  }

  // ---------------------------------------------------------------------------

  private async safeRefresh(realmId: string): Promise<void> {
    try {
      await this.authService.refreshTokens(realmId);
    } catch (error) {
      const isAuthError = error instanceof QboReauthorizationRequiredException;

      this.logger.error(
        `QBO token refresh failed for realm ${realmId}` +
          (isAuthError ? ' — reauthorization required' : '') +
          `: ${String(error)}`,
      );

      // Notify the rest of the system so it can alert or pause billing jobs.
      this.eventEmitter.emit('qbo.connection.broken', {
        realmId,
        requiresReauth: isAuthError,
        error,
      });
    }
  }
}
