import type { Repository } from 'typeorm';
import { InvoiceScan } from '../entities/invoice-scan.entity';
import { InvoiceScanNotificationsService } from '../services/invoice-scans/invoice-scan-notifications.service';
import { InvoiceScanReminderCron } from './invoice-scan-reminder.cron';

const NOW = new Date('2026-09-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function scan(overrides: Partial<InvoiceScan>): InvoiceScan {
  return {
    id: 'scan',
    status: 'needs_review',
    enteredAt: null,
    remindedAt: null,
    createdAt: new Date(NOW.getTime() - 5 * DAY),
    ...overrides,
  } as InvoiceScan;
}

function build(pending: InvoiceScan[]) {
  const scans = { find: jest.fn().mockResolvedValue(pending) };
  const notifications = { sendPendingReminder: jest.fn().mockResolvedValue(true) };
  const cron = new InvoiceScanReminderCron(
    scans as unknown as Repository<InvoiceScan>,
    notifications as unknown as InvoiceScanNotificationsService,
  );
  return { cron, scans, notifications };
}

describe('InvoiceScanReminderCron', () => {
  it('sends one reminder listing every pending scan when any has waited three days', async () => {
    const stale = scan({ id: 'stale' });
    const fresh = scan({ id: 'fresh', createdAt: new Date(NOW.getTime() - DAY) });
    const { cron, scans, notifications } = build([stale, fresh]);

    await expect(cron.remindPendingInvoices(NOW)).resolves.toBe(true);

    expect(scans.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'needs_review' }) }),
    );
    expect(notifications.sendPendingReminder).toHaveBeenCalledWith([stale, fresh], NOW);
  });

  it('stays quiet while every pending scan was reminded less than three days ago', async () => {
    const { cron, notifications } = build([
      scan({ id: 'a', remindedAt: new Date(NOW.getTime() - 2 * DAY) }),
      scan({ id: 'b', createdAt: new Date(NOW.getTime() - DAY) }),
    ]);

    await expect(cron.remindPendingInvoices(NOW)).resolves.toBe(false);
    expect(notifications.sendPendingReminder).not.toHaveBeenCalled();
  });

  it('does nothing without pending scans', async () => {
    const { cron, notifications } = build([]);
    await expect(cron.remindPendingInvoices(NOW)).resolves.toBe(false);
    expect(notifications.sendPendingReminder).not.toHaveBeenCalled();
  });

  it('swallows repository failures', async () => {
    const { cron, scans } = build([]);
    scans.find.mockRejectedValue(new Error('db down'));
    await expect(cron.remindPendingInvoices(NOW)).resolves.toBe(false);
  });
});
