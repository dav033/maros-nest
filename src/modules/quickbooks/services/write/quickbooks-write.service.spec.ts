import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QuickbooksWriteService } from './quickbooks-write.service';

const envelope = (type: string, entity: Record<string, unknown>) => ({ [type]: entity });

function setup(opts: { scan?: Record<string, unknown> | null; entities?: Record<string, Record<string, unknown>>; attachables?: unknown[]; bills?: unknown[] } = {}) {
  const scanRow =
    opts.scan === null
      ? null
      : {
          id: 'scan-1',
          fileKey: 'invoice-scans/a.pdf',
          fileName: 'INV-8841.pdf',
          contentType: 'application/pdf',
          enteredAt: null,
          extractedData: { direction: 'incoming', counterpartyType: 'Vendor', counterpartyId: '58', counterpartyName: 'Lion', invoiceNumber: 'INV-8841', issueDate: '2026-10-16', total: 980.89, lineItems: [] },
          ...opts.scan,
        };
  const entities = opts.entities ?? { 'Bill:123': { Id: '123', SyncToken: '4', PrivateNote: 'existing' } };
  const api = {
    getById: jest.fn((_realm: string, type: string, id: string) => {
      const found = entities[`${type}:${id}`];
      return found ? Promise.resolve(envelope(type, found)) : Promise.reject(new Error('Object Not Found'));
    }),
    unwrapQboEntity: jest.fn((response: Record<string, unknown> | null, type: string) => (response?.[type] as Record<string, unknown>) ?? {}),
    query: jest.fn((_realm: string, q: string) => Promise.resolve(q.includes('from Attachable') ? { a: opts.attachables ?? [] } : { b: opts.bills ?? [] })),
    getQueryResponseArray: jest.fn((response: Record<string, unknown[]> | null) => Object.values(response ?? {})[0] ?? []),
    escapeQboString: jest.fn((value: string) => value.replace(/'/g, "\\'")),
    postRaw: jest.fn().mockResolvedValue({ AttachableResponse: [{ Attachable: { Id: 'att-9' } }] }),
    mutateEntity: jest.fn().mockResolvedValue({ Bill: { Id: '123', SyncToken: '5' } }),
  };
  const s3 = { getObjectBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 data'), contentType: 'application/pdf', fileName: 'a.pdf' }) };
  const scans = { findOneBy: jest.fn().mockResolvedValue(scanRow) };
  return { service: new QuickbooksWriteService(api as never, s3 as never, scans as never), api, s3, scans };
}

describe('attachScanFile', () => {
  const input = { invoiceScanId: 'scan-1', entityType: 'Bill' as const, entityId: '123' };

  it('previews by default and sends nothing', async () => {
    const { service, api } = setup();

    const result = await service.attachScanFile('R1', { ...input, confirm: false });

    expect(result).toMatchObject({ executed: false, alreadyAttached: false, fileName: 'INV-8841.pdf', bytes: 13, entity: { type: 'Bill', id: '123' } });
    expect(api.postRaw).not.toHaveBeenCalled();
  });

  it('uploads with a matching multipart boundary when confirmed', async () => {
    const { service, api } = setup();

    const result = await service.attachScanFile('R1', { ...input, confirm: true });

    expect(result).toMatchObject({ executed: true, attachableId: 'att-9' });
    const [realm, path, body, headers] = api.postRaw.mock.calls[0];
    expect([realm, path]).toEqual(['R1', '/upload']);
    const boundary = /boundary=(.+)$/.exec((headers as Record<string, string>)['Content-Type'])![1];
    const text = (body as Buffer).toString('utf8');
    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    expect(text).toContain('"AttachableRef":[{"EntityRef":{"type":"Bill","value":"123"}}]');
  });

  it('does not attach the same file twice', async () => {
    const { service, api, s3 } = setup({ attachables: [{ Id: 'x', FileName: 'INV-8841.pdf' }] });

    const result = await service.attachScanFile('R1', { ...input, confirm: true });

    expect(result).toMatchObject({ executed: false, alreadyAttached: true });
    expect(api.postRaw).not.toHaveBeenCalled();
    expect(s3.getObjectBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-numeric entity id', { entityId: '12; drop' }, BadRequestException],
    ['a transaction that does not exist', { entityId: '999' }, BadRequestException],
  ])('refuses %s', async (_label, override, error) => {
    const { service, api } = setup();

    await expect(service.attachScanFile('R1', { ...input, ...override, confirm: true })).rejects.toBeInstanceOf(error);
    expect(api.postRaw).not.toHaveBeenCalled();
  });

  it('refuses an unknown scan, a scan without file and an unsupported file type', async () => {
    await expect(setup({ scan: null }).service.attachScanFile('R1', { ...input, confirm: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ scan: { fileKey: null } }).service.attachScanFile('R1', { ...input, confirm: true })).rejects.toThrow(/no tiene documento/);
    await expect(setup({ scan: { contentType: 'application/zip' } }).service.attachScanFile('R1', { ...input, confirm: true })).rejects.toThrow(/no admitido/);
  });

  it('refuses a file over 5 MB', async () => {
    const { service, s3, api } = setup();
    s3.getObjectBuffer.mockResolvedValue({ buffer: Buffer.alloc(6 * 1024 * 1024), contentType: null, fileName: 'a' });

    await expect(service.attachScanFile('R1', { ...input, confirm: true })).rejects.toThrow(/supera 5 MB/);
    expect(api.postRaw).not.toHaveBeenCalled();
  });
});

describe('updatePrivateNote', () => {
  const input = { entityType: 'Bill' as const, entityId: '123', note: 'Checked by Maros', mode: 'append' as const };

  it('previews the new note and writes nothing without confirm', async () => {
    const { service, api } = setup();

    const result = await service.updatePrivateNote('R1', { ...input, confirm: false });

    expect(result).toMatchObject({ executed: false, current: 'existing', next: 'existing\nChecked by Maros' });
    expect(api.mutateEntity).not.toHaveBeenCalled();
  });

  it('does a sparse update with the SyncToken, touching only PrivateNote', async () => {
    const { service, api } = setup();

    const result = await service.updatePrivateNote('R1', { ...input, confirm: true });

    expect(api.mutateEntity).toHaveBeenCalledWith('R1', 'Bill', { Id: '123', SyncToken: '4', sparse: true, PrivateNote: 'existing\nChecked by Maros' });
    expect(result).toMatchObject({ executed: true, syncToken: '5' });
  });

  it('writes nothing when the note would not change', async () => {
    const { service, api } = setup();

    const result = await service.updatePrivateNote('R1', { ...input, note: 'existing', mode: 'replace', confirm: true });

    expect(result.executed).toBe(false);
    expect(api.mutateEntity).not.toHaveBeenCalled();
  });

  it('refuses a missing transaction or a bad id', async () => {
    await expect(setup().service.updatePrivateNote('R1', { ...input, entityId: '999', confirm: true })).rejects.toThrow(/No existe Bill 999/);
    await expect(setup().service.updatePrivateNote('R1', { ...input, entityId: 'abc', confirm: true })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('previewBill', () => {
  it('returns the payload and creates nothing', async () => {
    const { service, api } = setup();

    const result = await service.previewBill('R1', { invoiceScanId: 'scan-1', accountId: '54' });

    expect(result.ready).toBe(true);
    expect(result.possibleDuplicates).toEqual([]);
    expect(api.mutateEntity).not.toHaveBeenCalled();
    expect(api.postRaw).not.toHaveBeenCalled();
  });

  it('is blocked when QuickBooks already has a bill with that number for the vendor', async () => {
    const { service } = setup({ bills: [{ Id: '777', DocNumber: 'INV-8841', TotalAmt: 980.89 }] });

    const result = await service.previewBill('R1', { invoiceScanId: 'scan-1', accountId: '54' });

    expect(result.ready).toBe(false);
    expect(result.possibleDuplicates).toEqual([{ id: '777', docNumber: 'INV-8841', totalAmt: 980.89 }]);
    expect(result.blockers.join(' ')).toContain('777');
  });

  it('explains what is missing without an account and refuses an unknown scan', async () => {
    const { service } = setup();

    expect((await service.previewBill('R1', { invoiceScanId: 'scan-1' })).blockers.join(' ')).toContain('expense account');
    await expect(setup({ scan: null }).service.previewBill('R1', { invoiceScanId: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
