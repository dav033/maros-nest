import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { MailService } from '../../../mail/services/mail.service';
import { InvoiceScan } from '../../entities/invoice-scan.entity';
import {
  DEVELOPMENT_INVOICE_INBOX,
  InvoiceScanNotificationsService,
  PRODUCTION_INVOICE_INBOX,
} from './invoice-scan-notifications.service';

function build(env: Record<string, string | undefined>) {
  const scans = { update: jest.fn().mockResolvedValue(undefined) };
  const mail = { sendMail: jest.fn().mockResolvedValue({ sent: true, messageId: 'm-1' }) };
  const config = { get: jest.fn((key: string) => env[key]) };
  const service = new InvoiceScanNotificationsService(
    scans as unknown as Repository<InvoiceScan>,
    mail as unknown as MailService,
    config as unknown as ConfigService,
  );
  return { service, scans, mail };
}

const scan = {
  id: '8c81e542-2141-4ba4-b4f4-fb442eb2fafe',
  fileName: '050P-Lyon.pdf',
  projectNumber: '050P-0826',
  warnings: ['Total could not be read; enter it from the document.'],
  notifiedAt: null,
  createdAt: new Date('2026-09-18T12:00:00Z'),
  extractedData: {
    invoiceNumber: '<4022039>',
    counterpartyName: 'Lion & Sons',
    total: 87.73,
    currency: 'USD',
  },
} as unknown as InvoiceScan;

describe('InvoiceScanNotificationsService', () => {
  it('picks the inbox from the environment', () => {
    expect(build({ NODE_ENV: 'production' }).service.recipient()).toBe(PRODUCTION_INVOICE_INBOX);
    expect(build({ NODE_ENV: 'development' }).service.recipient()).toBe(DEVELOPMENT_INVOICE_INBOX);
    expect(build({ NODE_ENV: 'production', INVOICE_SCAN_NOTIFY_EMAIL: ' x@y.z ' }).service.recipient()).toBe('x@y.z');
  });

  it('emails the ready notice once, with an app link and escaped content', async () => {
    const { service, mail, scans } = build({ NODE_ENV: 'development', TASK_APP_URL: 'http://localhost:3000/' });

    await expect(service.notifyScanReady(scan)).resolves.toBe(true);

    const sent = mail.sendMail.mock.calls[0][0] as { to: string[]; subject: string; html: string; text: string };
    expect(sent.to).toEqual([DEVELOPMENT_INVOICE_INBOX]);
    expect(sent.subject).toContain('Invoice <4022039>');
    expect(sent.text).toContain(`http://localhost:3000/finance/invoices/${scan.id}`);
    expect(sent.html).toContain('&lt;4022039&gt;');
    expect(sent.html).toContain('Total could not be read');
    expect(scans.update).toHaveBeenCalledWith({ id: scan.id }, { notifiedAt: expect.any(Date) });

    await expect(service.notifyScanReady({ ...scan, notifiedAt: new Date() } as InvoiceScan)).resolves.toBe(false);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('never throws when mail fails and leaves notifiedAt untouched', async () => {
    const { service, mail, scans } = build({ NODE_ENV: 'development' });
    mail.sendMail.mockRejectedValue(new Error('smtp down'));

    await expect(service.notifyScanReady(scan)).resolves.toBe(false);
    expect(scans.update).not.toHaveBeenCalled();
  });

  it('sends the pending reminder with days pending and stamps remindedAt', async () => {
    const { service, mail, scans } = build({ NODE_ENV: 'production' });
    const now = new Date('2026-09-22T12:00:00Z');

    await expect(service.sendPendingReminder([scan], now)).resolves.toBe(true);

    const sent = mail.sendMail.mock.calls[0][0] as { to: string[]; subject: string; text: string };
    expect(sent.to).toEqual([PRODUCTION_INVOICE_INBOX]);
    expect(sent.subject).toBe('1 invoice still to enter in QuickBooks');
    expect(sent.text).toContain('pending 4 days');
    expect(sent.text).toContain('https://app.marosconstruction.com/finance/invoices');
    expect(scans.update).toHaveBeenCalledWith(expect.anything(), { remindedAt: now });
  });
});
