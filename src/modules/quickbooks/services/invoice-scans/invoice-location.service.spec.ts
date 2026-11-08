import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceLocationService, isMissingTable } from './invoice-location.service';

const missingTable = Object.assign(new Error('relation "invoice_document_locations" does not exist'), {
  driverError: { code: '42P01' },
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loc-1',
    invoiceScanId: 'scan-1',
    driveFileId: 'drive-1',
    driveUrl: 'https://drive/1',
    driveName: '064P-Lion-980.89.pdf',
    driveFolder: 'Maros/Receipts/064P-0826',
    status: 'in_receipts',
    receivedAt: new Date('2026-11-08T10:00:00Z'),
    updatedAt: new Date('2026-11-08T10:00:00Z'),
    ...overrides,
  };
}

function setup() {
  const locations = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: Record<string, unknown>) => Promise.resolve({ id: 'loc-1', ...value })),
  };
  const events = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const service = new InvoiceLocationService(locations as never, events as never);
  return { service, locations, events };
}

describe('isMissingTable', () => {
  it('recognises Postgres undefined_table only', () => {
    expect(isMissingTable(missingTable)).toBe(true);
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable(new Error('boom'))).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe('InvoiceLocationService.recordFiled', () => {
  const input = {
    invoiceScanId: 'scan-1',
    driveFileId: 'drive-1',
    driveUrl: 'https://drive/1',
    driveName: '064P-Lion-980.89.pdf',
    driveFolder: 'Maros/Receipts/064P-0826',
    actor: 'luis@maros.test',
  };

  it('records the location and its first history event', async () => {
    const { service, locations, events } = setup();

    await expect(service.recordFiled(input)).resolves.toBe(true);

    expect(locations.save).toHaveBeenCalledWith(expect.objectContaining({ driveFileId: 'drive-1', status: 'in_receipts', driveFolder: 'Maros/Receipts/064P-0826' }));
    expect(events.save).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'loc-1', fromStatus: null, toStatus: 'in_receipts', actor: 'luis@maros.test' }));
  });

  it('is idempotent: a file already recorded adds nothing', async () => {
    const { service, locations, events } = setup();
    locations.findOneBy.mockResolvedValue(row());

    await expect(service.recordFiled(input)).resolves.toBe(true);

    expect(locations.save).not.toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  });

  it('never throws, even when the migration is not applied or the database fails', async () => {
    const { service, locations } = setup();
    locations.findOneBy.mockRejectedValue(missingTable);
    await expect(service.recordFiled(input)).resolves.toBe(false);

    locations.findOneBy.mockRejectedValue(new Error('connection reset'));
    await expect(service.recordFiled(input)).resolves.toBe(false);
  });
});

describe('InvoiceLocationService.update', () => {
  it('changes the state and folder and writes the history', async () => {
    const { service, locations, events } = setup();
    locations.find.mockResolvedValue([row()]);

    const result = await service.update({ invoiceScanId: 'scan-1', status: 'categorized', driveFolder: 'Maros/Receipts/Categorized/064P', note: 'Alexandra categorised it', actor: 'mcp' });

    expect(result.changed).toBe(true);
    expect(result.location).toMatchObject({ status: 'categorized', driveFolder: 'Maros/Receipts/Categorized/064P' });
    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: 'in_receipts', toStatus: 'categorized', driveFolder: 'Maros/Receipts/Categorized/064P', note: 'Alexandra categorised it', actor: 'mcp' }),
    );
  });

  it('writes nothing when nothing changes and no note is given', async () => {
    const { service, locations, events } = setup();
    locations.find.mockResolvedValue([row()]);

    const result = await service.update({ invoiceScanId: 'scan-1', status: 'in_receipts', actor: 'mcp' });

    expect(result.changed).toBe(false);
    expect(locations.save).not.toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  });

  it('says to file the invoice first when nothing is recorded', async () => {
    const { service } = setup();

    await expect(service.update({ invoiceScanId: 'scan-1', status: 'moved', actor: 'mcp' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('asks for driveFileId when an invoice has several Drive files', async () => {
    const { service, locations } = setup();
    locations.find.mockResolvedValue([row({ driveFileId: 'drive-1' }), row({ id: 'loc-2', driveFileId: 'drive-2' })]);

    await expect(service.update({ invoiceScanId: 'scan-1', status: 'moved', actor: 'mcp' })).rejects.toThrow(/pass driveFileId \(drive-1, drive-2\)/);
  });

  it('explains the missing migration instead of a raw SQL error', async () => {
    const { service, locations } = setup();
    locations.find.mockRejectedValue(missingTable);

    await expect(service.update({ invoiceScanId: 'scan-1', status: 'moved', actor: 'mcp' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('InvoiceLocationService.history and forScans', () => {
  it('returns each location with its events in order', async () => {
    const { service, locations, events } = setup();
    locations.find.mockResolvedValue([row()]);
    events.find.mockResolvedValue([
      { locationId: 'loc-1', fromStatus: null, toStatus: 'in_receipts', driveFolder: 'f', note: null, actor: 'luis', createdAt: new Date('2026-11-08T10:00:00Z') },
      { locationId: 'loc-1', fromStatus: 'in_receipts', toStatus: 'moved', driveFolder: 'g', note: 'n', actor: 'mcp', createdAt: new Date('2026-11-09T10:00:00Z') },
    ]);

    const history = await service.history('scan-1');

    expect(history).toHaveLength(1);
    expect(history[0].events.map((event) => event.toStatus)).toEqual(['in_receipts', 'moved']);
  });

  it('groups locations by scan, and returns an empty map when the tables are missing', async () => {
    const { service, locations } = setup();
    locations.find.mockResolvedValue([row(), row({ id: 'loc-2', invoiceScanId: 'scan-2', driveFileId: 'drive-2' })]);

    const grouped = await service.forScans(['scan-1', 'scan-2']);
    expect([...grouped.keys()]).toEqual(['scan-1', 'scan-2']);

    locations.find.mockRejectedValue(missingTable);
    expect((await service.forScans(['scan-1'])).size).toBe(0);
    expect((await service.forScans([])).size).toBe(0);
  });
});
