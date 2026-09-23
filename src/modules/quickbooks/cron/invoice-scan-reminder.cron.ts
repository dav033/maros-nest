import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InvoiceScan } from '../entities/invoice-scan.entity';
import { InvoiceScanNotificationsService } from '../services/invoice-scans/invoice-scan-notifications.service';

/** A pending invoice is nagged about again once this long has passed since its last reminder. */
export const REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Every morning: if any scanned invoice has been waiting three days or more
 * since it was last mentioned (or since it was scanned), send ONE email
 * listing everything that is still not entered in QuickBooks.
 */
@Injectable()
export class InvoiceScanReminderCron {
  private readonly logger = new Logger(InvoiceScanReminderCron.name);

  constructor(
    @InjectRepository(InvoiceScan)
    private readonly scans: Repository<InvoiceScan>,
    private readonly notifications: InvoiceScanNotificationsService,
  ) {}

  @Cron('0 8 * * *', { name: 'invoice-scan-reminder', timeZone: 'America/New_York' })
  async remindPendingInvoices(now = new Date()): Promise<boolean> {
    try {
      const pending = await this.scans.find({
        where: { status: 'needs_review', enteredAt: IsNull() },
        order: { createdAt: 'ASC' },
      });
      if (!InvoiceScanReminderCron.isReminderDue(pending, now)) return false;

      const sent = await this.notifications.sendPendingReminder(pending, now);
      this.logger.log(
        sent
          ? `Pending-invoice reminder sent for ${pending.length} scan(s)`
          : `Pending-invoice reminder for ${pending.length} scan(s) could not be sent`,
      );
      return sent;
    } catch (error) {
      this.logger.error(
        `Pending-invoice reminder failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  static isReminderDue(pending: InvoiceScan[], now: Date): boolean {
    return pending.some((scan) => {
      const reference = scan.remindedAt ?? scan.createdAt;
      return now.getTime() - new Date(reference).getTime() >= REMINDER_INTERVAL_MS;
    });
  }
}
