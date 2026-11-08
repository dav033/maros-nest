import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { GoogleWorkspaceService } from './google-workspace.service';

function user(permissions: string[]): AuthenticatedUser {
  return { id: 7, email: 'luis@maros.test', permissions } as unknown as AuthenticatedUser;
}

function setup() {
  const drafts = { createDraft: jest.fn().mockResolvedValue({ draftId: 'd1' }) };
  const drive = {
    upload: jest.fn().mockResolvedValue({ id: 'f1', url: 'https://drive/f1', alreadyExisted: false }),
    search: jest.fn().mockResolvedValue({ visibility: 'all', files: [] }),
  };
  const attachments = {
    resolveAll: jest.fn().mockResolvedValue([]),
    loadInvoiceFile: jest.fn(),
  };
  const gmailImport = {
    importLabel: jest.fn().mockResolvedValue({ saved: [], duplicates: 0, skipped: [] }),
  };
  const locations = { recordFiled: jest.fn().mockResolvedValue(true) };
  const labels = { ensureLabel: jest.fn().mockResolvedValue({ id: 'L9', name: 'Invoices', created: true }) };
  const service = new GoogleWorkspaceService(drafts as never, drive as never, attachments as never, gmailImport as never, locations as never, labels as never);
  return { service, drafts, drive, attachments, gmailImport, locations, labels };
}

describe('createDraftWithAttachment', () => {
  it('resolves attachments as the acting person, and a Drive file needs no finance permission', async () => {
    const { service, attachments } = setup();

    await service.createDraftWithAttachment(user([]), {
      to: ['v@x.com'],
      subject: 's',
      text: 't',
      attachments: [{ kind: 'drive_file', fileId: 'abcdefghij12345' }],
    });

    expect(attachments.resolveAll).toHaveBeenCalledWith(7, [{ kind: 'drive_file', fileId: 'abcdefghij12345' }]);
  });

  it('creates the draft as the person, with the resolved attachments', async () => {
    const { service, drafts, attachments } = setup();
    attachments.resolveAll.mockResolvedValue([{ fileName: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('x') }]);

    await service.createDraftWithAttachment(user(['finance:read']), {
      to: ['v@x.com'],
      subject: 'Facturas',
      text: 'Hola',
      attachments: [{ kind: 'invoice_scan', id: 'abc' }],
    });

    expect(drafts.createDraft).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ to: ['v@x.com'], subject: 'Facturas', attachments: expect.any(Array) }),
    );
  });

  it('refuses invoice attachments without finance:read, before reading anything', async () => {
    const { service, attachments, drafts } = setup();

    await expect(
      service.createDraftWithAttachment(user([]), {
        to: ['v@x.com'],
        subject: 's',
        text: 't',
        attachments: [{ kind: 'invoice_scan', id: 'abc' }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attachments.resolveAll).not.toHaveBeenCalled();
    expect(drafts.createDraft).not.toHaveBeenCalled();
  });

  it('does not need finance permission for a draft without invoices', async () => {
    const { service, drafts } = setup();

    await service.createDraftWithAttachment(user([]), { to: ['v@x.com'], subject: 's', text: 't' });

    expect(drafts.createDraft).toHaveBeenCalled();
  });
});

describe('saveReportToDrive', () => {
  it('stores under Reports/<folder> with a namespaced key', async () => {
    const { service, drive } = setup();

    await service.saveReportToDrive(user([]), {
      name: 'cobros.md',
      contentType: 'text/markdown',
      text: '# Cobros',
      folder: ['064P-0826'],
      key: 'cobros-2026-11',
    });

    expect(drive.upload).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        folderPath: ['Reports', '064P-0826'],
        name: 'cobros.md',
        mimeType: 'text/markdown',
        key: 'report:cobros-2026-11',
      }),
    );
  });

  it.each([
    ['a disallowed type', { contentType: 'application/x-msdownload', text: 'x' }],
    ['both text and base64', { contentType: 'text/plain', text: 'x', contentBase64: 'eA==' }],
    ['no content', { contentType: 'text/plain' }],
    ['empty text', { contentType: 'text/plain', text: '' }],
  ])('rejects %s without calling Drive', async (_label, extra) => {
    const { service, drive } = setup();

    await expect(service.saveReportToDrive(user([]), { name: 'r', ...extra })).rejects.toThrow();
    expect(drive.upload).not.toHaveBeenCalled();
  });
});

describe('saveInvoiceToReceipts', () => {
  const file = {
    scan: {
      id: 'scan-1',
      fileName: 'IMG_0042.jpg',
      projectNumber: '064P-0826',
      extractedData: { issueDate: '2026-10-16', counterpartyName: 'The Home Depot #4021', invoiceNumber: 'INV 99', total: 1250, currency: 'USD' },
    },
    content: Buffer.from('bytes'),
    contentType: 'image/jpeg',
  };

  it('files it as Proyecto-Proveedor-Valor under Receipts/<project>, never overwriting', async () => {
    const { service, drive, attachments } = setup();
    attachments.loadInvoiceFile.mockResolvedValue(file);

    await service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' });

    expect(drive.upload).toHaveBeenCalledWith(7, {
      folderPath: ['Receipts', '064P-0826'],
      name: '064P-HomeDepot-1250.00.jpg',
      mimeType: 'image/jpeg',
      content: file.content,
      key: 'invoice_scan:scan-1',
      avoidOverwrite: true,
    });
  });

  it('lets the caller supply or override project, vendor and amount', async () => {
    const { service, drive, attachments } = setup();
    attachments.loadInvoiceFile.mockResolvedValue({
      ...file,
      scan: { ...file.scan, projectNumber: null, extractedData: { ...file.scan.extractedData, counterpartyName: null, total: null } },
    });

    await service.saveInvoiceToReceipts(user(['finance:write']), {
      invoiceScanId: 'scan-1',
      project: '070-0926',
      vendor: 'Bond Plumbing Supply, Inc.',
      amount: 40.7,
    });

    expect(drive.upload.mock.calls[0][1]).toMatchObject({
      folderPath: ['Receipts', '070-0926'],
      name: '070-BondPlumbingSupply-40.70.jpg',
    });
  });

  it('refuses to guess: a missing field stops the filing and says which one', async () => {
    const { service, drive, attachments } = setup();
    attachments.loadInvoiceFile.mockResolvedValue({
      ...file,
      scan: { ...file.scan, projectNumber: null, extractedData: { ...file.scan.extractedData, total: null } },
    });

    await expect(service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' })).rejects.toThrow(
      /faltan project, amount/,
    );
    expect(drive.upload).not.toHaveBeenCalled();
  });

  it('requires finance:write before touching storage', async () => {
    const { service, drive, attachments } = setup();

    await expect(
      service.saveInvoiceToReceipts(user(['finance:read']), { invoiceScanId: 'scan-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attachments.loadInvoiceFile).not.toHaveBeenCalled();
    expect(drive.upload).not.toHaveBeenCalled();
  });
});

describe('saveReportToDrive dating and overwrite safety', () => {
  const report = { name: 'jfb-cobros.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64'), folder: ['Maros Plumbing'] };

  it('puts the given date before the extension and never overwrites', async () => {
    const { service, drive } = setup();

    await service.saveReportToDrive(user([]), { ...report, addDate: true, date: '2026-11-08' });

    expect(drive.upload).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ name: 'jfb-cobros-2026-11-08.pdf', folderPath: ['Reports', 'Maros Plumbing'], avoidOverwrite: true }),
    );
  });

  it('uses today (US Eastern) when no date is given, and keeps the name without addDate', async () => {
    const { service, drive } = setup();

    await service.saveReportToDrive(user([]), { ...report, addDate: true });
    await service.saveReportToDrive(user([]), report);

    expect(drive.upload.mock.calls[0][1].name).toMatch(/^jfb-cobros-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(drive.upload.mock.calls[1][1].name).toBe('jfb-cobros.pdf');
  });
});

describe('searchDriveFiles and importGmailInvoices', () => {
  it('searches Drive as the acting person', async () => {
    const { service, drive } = setup();

    await service.searchDriveFiles(user([]), { nameContains: 'waiver', limit: 20 });

    expect(drive.search).toHaveBeenCalledWith(7, { nameContains: 'waiver', limit: 20 });
  });

  it('imports a label as the acting person when they have finance:write', async () => {
    const { service, gmailImport } = setup();

    await service.importGmailInvoices(user(['finance:write']), { label: 'Invoices', maxMessages: 10 });

    expect(gmailImport.importLabel).toHaveBeenCalledWith(7, { label: 'Invoices', maxMessages: 10 });
  });

  it('refuses the import without finance:write before reading any mail', async () => {
    const { service, gmailImport } = setup();

    await expect(service.importGmailInvoices(user(['finance:read']), { label: 'Invoices', maxMessages: 10 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(gmailImport.importLabel).not.toHaveBeenCalled();
  });
});

describe('saveInvoiceToReceipts and the invoice index', () => {
  const file = {
    scan: {
      id: 'scan-1',
      fileName: 'a.pdf',
      projectNumber: '064P-0826',
      extractedData: { counterpartyName: 'Lion Plumbing Supply Inc.', total: 980.89, currency: 'USD' },
    },
    content: Buffer.from('x'),
    contentType: 'application/pdf',
  };

  it('records where the document was filed, as the acting person', async () => {
    const { service, drive, attachments, locations } = setup();
    attachments.loadInvoiceFile.mockResolvedValue(file);
    drive.upload.mockResolvedValue({ id: 'drive-9', name: '064P-LionPlumbingSupply-980.89.pdf', url: 'https://drive/9', folder: 'Maros/Receipts/064P-0826', alreadyExisted: false, renamed: false });

    await service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' });

    expect(locations.recordFiled).toHaveBeenCalledWith({
      invoiceScanId: 'scan-1',
      driveFileId: 'drive-9',
      driveUrl: 'https://drive/9',
      driveName: '064P-LionPlumbingSupply-980.89.pdf',
      driveFolder: 'Maros/Receipts/064P-0826',
      actor: 'luis@maros.test',
    });
  });

  it('still returns the filed document when the index could not record it', async () => {
    const { service, drive, attachments, locations } = setup();
    attachments.loadInvoiceFile.mockResolvedValue(file);
    drive.upload.mockResolvedValue({ id: 'drive-9', name: 'n.pdf', url: 'u', folder: 'f', alreadyExisted: false, renamed: false });
    locations.recordFiled.mockResolvedValue(false);

    await expect(service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' })).resolves.toMatchObject({ id: 'drive-9' });
  });

  it('does not record anything when the filing is refused', async () => {
    const { service, attachments, locations } = setup();
    attachments.loadInvoiceFile.mockResolvedValue({ ...file, scan: { ...file.scan, projectNumber: null } });

    await expect(service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' })).rejects.toThrow(/faltan project/);
    expect(locations.recordFiled).not.toHaveBeenCalled();
  });
});

describe('ensureGmailLabel', () => {
  it('creates the label as the acting person when they have finance:write', async () => {
    const { service, labels } = setup();

    await expect(service.ensureGmailLabel(user(['finance:write']), 'Invoices')).resolves.toMatchObject({ created: true });
    expect(labels.ensureLabel).toHaveBeenCalledWith(7, 'Invoices');
  });

  it('refuses without finance:write before touching the mailbox', async () => {
    const { service, labels } = setup();

    await expect(service.ensureGmailLabel(user([]), 'Invoices')).rejects.toBeInstanceOf(ForbiddenException);
    expect(labels.ensureLabel).not.toHaveBeenCalled();
  });
});
