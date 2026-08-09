import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NoteLinksRepository } from '../note-management/repositories/note-links.repository';
import { NoteSharesRepository } from '../note-management/repositories/note-shares.repository';

/** Long enough to be useful, short enough not to become a standing record of readers. */
const VIEW_RETENTION_DAYS = 90;

/**
 * Nightly sweep for the three things sharing leaves behind.
 *
 * None of it is load-bearing — every read path already checks expiry inline, and a
 * grant pointing at a deleted user simply matches nothing. This exists so the tables
 * stay honest: a `revoked_at` that reflects reality makes the admin panel truthful, and
 * a view log nobody prunes turns from an audit trail into a liability.
 */
@Injectable()
export class NoteSharingMaintenanceCron {
  private readonly logger = new Logger(NoteSharingMaintenanceCron.name);

  constructor(
    private readonly links: NoteLinksRepository,
    private readonly shares: NoteSharesRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    try {
      const [revoked, orphaned, purgedViews] = await Promise.all([
        this.links.revokeExpired(),
        this.shares.deleteOrphanedSubjects(),
        this.links.purgeViewsOlderThan(VIEW_RETENTION_DAYS),
      ]);

      if (revoked || orphaned || purgedViews) {
        this.logger.log(
          `Note sharing sweep: ${revoked} link(s) marked revoked on expiry, ` +
            `${orphaned} grant(s) for deleted users/roles removed, ` +
            `${purgedViews} view record(s) older than ${VIEW_RETENTION_DAYS} days purged`,
        );
      }
    } catch (error) {
      // A failed sweep must not take the scheduler down; everything it does is
      // idempotent and the next run picks up whatever was missed.
      this.logger.error(
        `Note sharing sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
