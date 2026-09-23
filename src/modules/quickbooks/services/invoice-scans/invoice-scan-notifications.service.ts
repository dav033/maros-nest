import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MailService } from '../../../mail/services/mail.service';
import { InvoiceScan } from '../../entities/invoice-scan.entity';
import {
  type InvoiceEmailItem,
  renderInvoicePendingReminderEmail,
  renderInvoiceScanReadyEmail,
} from './invoice-scan-email-templates';

export const PRODUCTION_INVOICE_INBOX = 'agonzalez@marosconstruction.com';
export const DEVELOPMENT_INVOICE_INBOX = 'david.theran03@gmail.com';
const DEFAULT_APP_URL = 'https://app.marosconstruction.com';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Emails around the invoice review workflow. Every method swallows mail
 * failures (logged): a broken SMTP must never fail a scan or the cron.
 */
@Injectable()
export class InvoiceScanNotificationsService {
  private readonly logger = new Logger(InvoiceScanNotificationsService.name);

  constructor(
    @InjectRepository(InvoiceScan)
    private readonly scans: Repository<InvoiceScan>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** INVOICE_SCAN_NOTIFY_EMAIL wins; otherwise the inbox depends on NODE_ENV. */
  recipient(): string {
    const configured = this.config.get<string>('INVOICE_SCAN_NOTIFY_EMAIL')?.trim();
    if (configured) return configured;
    return this.config.get<string>('NODE_ENV') === 'production'
      ? PRODUCTION_INVOICE_INBOX
      : DEVELOPMENT_INVOICE_INBOX;
  }

  scanUrl(id: string): string {
    return `${this.appUrl()}/finance/invoices/${id}`;
  }

  listUrl(): string {
    return `${this.appUrl()}/finance/invoices`;
  }

  /** "Ready to review" email, sent once per scan. Returns whether it went out. */
  async notifyScanReady(scan: InvoiceScan): Promise<boolean> {
    if (scan.notifiedAt) return false;
    const email = renderInvoiceScanReadyEmail({
      item: this.toItem(scan, new Date()),
      warnings: scan.warnings ?? [],
    });
    const sent = await this.send(email, `scan ${scan.id}`);
    if (sent) {
      await this.scans.update({ id: scan.id }, { notifiedAt: new Date() });
    }
    return sent;
  }

  /** One email listing every pending scan; stamps remindedAt on all of them. */
  async sendPendingReminder(pending: InvoiceScan[], now = new Date()): Promise<boolean> {
    if (pending.length === 0) return false;
    const email = renderInvoicePendingReminderEmail({
      items: pending.map((scan) => this.toItem(scan, now)),
      listUrl: this.listUrl(),
    });
    const sent = await this.send(email, `${pending.length} pending scan(s)`);
    if (sent) {
      await this.scans.update({ id: In(pending.map((scan) => scan.id)) }, { remindedAt: now });
    }
    return sent;
  }

  private toItem(scan: InvoiceScan, now: Date): InvoiceEmailItem {
    const invoice = scan.extractedData;
    return {
      id: scan.id,
      label: invoice?.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : scan.fileName,
      counterpartyName: invoice?.counterpartyName ?? null,
      projectNumber: scan.projectNumber,
      total: invoice?.total ?? null,
      currency: invoice?.currency ?? null,
      url: this.scanUrl(scan.id),
      daysPending: Math.max(
        0,
        Math.floor((now.getTime() - new Date(scan.createdAt).getTime()) / DAY_MS),
      ),
    };
  }

  private async send(
    email: { subject: string; text: string; html: string },
    what: string,
  ): Promise<boolean> {
    const to = this.recipient();
    try {
      const result = await this.mail.sendMail({ to: [to], ...email });
      this.logger.log(
        `Invoice email sent to ${to} for ${what} — messageId: ${result.messageId ?? 'N/A'}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Invoice email to ${to} failed for ${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private appUrl(): string {
    return (this.config.get<string>('TASK_APP_URL')?.trim() || DEFAULT_APP_URL).replace(
      /\/+$/,
      '',
    );
  }
}
