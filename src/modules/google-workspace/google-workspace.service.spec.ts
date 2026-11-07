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
  };
  const attachments = {
    resolveAll: jest.fn().mockResolvedValue([]),
    loadInvoiceFile: jest.fn(),
  };
  const service = new GoogleWorkspaceService(drafts as never, drive as never, attachments as never);
  return { service, drafts, drive, attachments };
}

describe('createDraftWithAttachment', () => {
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
      extractedData: { issueDate: '2026-10-16', counterpartyName: 'Lion Plumbing/Supply', invoiceNumber: 'INV 99' },
    },
    content: Buffer.from('bytes'),
    contentType: 'image/jpeg',
  };

  it('files it under Receipts/<project> with a readable, safe name and a stable key', async () => {
    const { service, drive, attachments } = setup();
    attachments.loadInvoiceFile.mockResolvedValue(file);

    await service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' });

    expect(drive.upload).toHaveBeenCalledWith(7, {
      folderPath: ['Receipts', '064P-0826'],
      name: '2026-10-16_Lion Plumbing-Supply_INV 99.jpg',
      mimeType: 'image/jpeg',
      content: file.content,
      key: 'invoice_scan:scan-1',
    });
  });

  it('lets the caller override the project and falls back to Unassigned', async () => {
    const { service, drive, attachments } = setup();
    attachments.loadInvoiceFile.mockResolvedValue({ ...file, scan: { ...file.scan, projectNumber: null } });

    await service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1' });
    await service.saveInvoiceToReceipts(user(['finance:write']), { invoiceScanId: 'scan-1', project: '070-0926' });

    expect(drive.upload.mock.calls[0][1].folderPath).toEqual(['Receipts', 'Unassigned']);
    expect(drive.upload.mock.calls[1][1].folderPath).toEqual(['Receipts', '070-0926']);
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
