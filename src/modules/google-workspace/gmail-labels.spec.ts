import { BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import { GmailLabelsService, isReservedLabelName } from './gmail-labels.service';

jest.mock('googleapis', () => ({ google: { gmail: jest.fn() } }));

const LABELS = 'https://www.googleapis.com/auth/gmail.labels';
const auth = { clientWithScope: jest.fn().mockResolvedValue({}) };

function mockGmail(existing: Array<{ id: string; name: string }>) {
  const list = jest.fn().mockResolvedValue({ data: { labels: existing } });
  const create = jest.fn().mockResolvedValue({ data: { id: 'NEW', name: 'Invoices' } });
  // Only list and create exist: anything else on labels would blow up the test.
  (google.gmail as jest.Mock).mockReturnValue({ users: { labels: { list, create } } });
  return { list, create };
}

beforeEach(() => jest.clearAllMocks());

describe('isReservedLabelName', () => {
  it.each(['INBOX', 'inbox', 'Sent', 'TRASH', 'spam', 'CATEGORY_PROMOTIONS', 'category_social'])('%s is reserved', (name) => {
    expect(isReservedLabelName(name)).toBe(true);
  });

  it.each(['Invoices', 'Inbox/Leads', 'Receipts 2026'])('%s is allowed', (name) => {
    expect(isReservedLabelName(name)).toBe(false);
  });
});

describe('GmailLabelsService.ensureLabel', () => {
  const service = () => new GmailLabelsService(auth as never);

  it('creates the label when it does not exist, with the labels scope', async () => {
    const { create } = mockGmail([{ id: 'L1', name: 'Notes' }]);

    const result = await service().ensureLabel(7, '  Invoices ');

    expect(auth.clientWithScope).toHaveBeenCalledWith(7, LABELS);
    expect(create.mock.calls[0][0].requestBody).toMatchObject({ name: 'Invoices', labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    expect(result).toEqual({ id: 'NEW', name: 'Invoices', created: true });
  });

  it('does nothing when it already exists, whatever the case', async () => {
    const { create } = mockGmail([{ id: 'L7', name: 'invoices' }]);

    const result = await service().ensureLabel(7, 'Invoices');

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'L7', name: 'invoices', created: false });
  });

  it.each(['Inbox', 'TRASH', 'CATEGORY_UPDATES', '   ', 'a\nb'])('refuses "%s" before contacting Gmail', async (name) => {
    mockGmail([]);

    await expect(service().ensureLabel(7, name)).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.clientWithScope).not.toHaveBeenCalled();
  });
});
