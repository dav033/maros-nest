import axios from 'axios';
import type { Cache } from 'cache-manager';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { S3Service } from '../../s3/services/s3.service';
import { InvoiceScan } from '../entities/invoice-scan.entity';
import { Lead } from '../../../entities/lead.entity';
import { QuickbooksApiService } from './core/quickbooks-api.service';
import { QuickbooksFinancialsService } from './financials/quickbooks-financials.service';
import { InvoiceScansService } from './invoice-scans.service';
import { InvoiceScanNotificationsService } from './invoice-scans/invoice-scan-notifications.service';

const SCAN_ID = '8c81e542-2141-4ba4-b4f4-fb442eb2fafe';

function baseScan(overrides: Partial<InvoiceScan> = {}): InvoiceScan {
  return {
    id: SCAN_ID,
    fileKey: 'mcp/attachments/invoice-scans/invoice.jpg',
    fileName: 'invoice.jpg',
    contentType: 'image/jpeg',
    status: 'uploaded',
    extractedData: null,
    qboSuggestions: {},
    errorMessage: null,
    projectNumber: null,
    warnings: [],
    enteredAt: null,
    enteredBy: null,
    updatedBy: null,
    comments: null,
    notifiedAt: null,
    remindedAt: null,
    createdAt: new Date('2026-09-12T12:00:00Z'),
    updatedAt: new Date('2026-09-12T12:00:00Z'),
    ...overrides,
  } as InvoiceScan;
}

function openAiPayload(overrides: Record<string, unknown> = {}) {
  return {
    direction: 'outgoing',
    classification: 'customer_service',
    counterparty_name: 'Maros Customer',
    invoice_number: 'INV-42',
    issue_date: '2026-09-01',
    due_date: null,
    currency: 'USD',
    subtotal: 120,
    tax_total: 0,
    total: 120,
    payment_status: 'unpaid',
    confidence: 0.96,
    project_number: null,
    line_items: [
      { description: 'Roof repair', quantity: 1, unit_price: 120, amount: 120 },
    ],
    ...overrides,
  };
}

function mockOpenAi(payload: Record<string, unknown>) {
  return jest.spyOn(axios, 'post').mockResolvedValue({
    data: {
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(payload) }],
        },
      ],
    },
  } as never);
}

interface Harness {
  scan: InvoiceScan;
  scans: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  s3: Record<string, jest.Mock>;
  qboApi: { queryAll: jest.Mock };
  financials: { getDefaultRealmId: jest.Mock };
  config: { get: jest.Mock };
  leads: { exists: jest.Mock; find: jest.Mock };
  notifications: { notifyScanReady: jest.Mock };
  cache: { get: jest.Mock; set: jest.Mock };
  savedStatuses: string[];
  service: InvoiceScansService;
}

function harness(opts: {
  scan?: Partial<InvoiceScan>;
  buffer?: Buffer;
  leadNumbers?: string[];
  leadExists?: boolean;
  qboFails?: boolean;
} = {}): Harness {
  const scan = baseScan(opts.scan);
  const savedStatuses: string[] = [];
  const scans = {
    findOne: jest.fn().mockResolvedValue(scan),
    create: jest.fn().mockImplementation((value: InvoiceScan) => value),
    save: jest.fn().mockImplementation((value: InvoiceScan) => {
      savedStatuses.push(value.status);
      return Promise.resolve(value);
    }),
    update: jest.fn().mockImplementation((_criteria, patch) => {
      Object.assign(scan, patch);
      return Promise.resolve({ affected: 1 });
    }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const s3 = {
    getObjectMetadata: jest.fn().mockResolvedValue({
      contentLength: 100,
      contentType: scan.contentType,
    }),
    getUploadRules: jest.fn().mockReturnValue({
      basePrefix: 'mcp/attachments/',
      maxUploadBytes: 5 * 1024 * 1024,
    }),
    getObjectBuffer: jest.fn().mockResolvedValue({
      buffer: opts.buffer ?? Buffer.from('invoice-photo'),
      contentType: scan.contentType,
      fileName: scan.fileName,
    }),
    deleteObject: jest.fn().mockResolvedValue({ deleted: true }),
    getPresignedGetUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://signed/download' }),
    getPresignedPutUrl: jest.fn().mockImplementation(({ prefix, fileName }) => ({
      key: `mcp/attachments/${prefix}/${fileName}`,
      url: 'https://signed/put',
    })),
  };
  const qboApi = {
    queryAll: jest.fn((realmId: string, entity: string) => {
      if (opts.qboFails) return Promise.reject(new Error('QBO down'));
      if (realmId !== 'realm-1') return Promise.resolve([]);
      if (entity === 'Customer') {
        return Promise.resolve([{ Id: 'customer-1', DisplayName: 'Maros Customer' }]);
      }
      return Promise.resolve([]);
    }),
  };
  const financials = { getDefaultRealmId: jest.fn().mockResolvedValue('realm-1') };
  const config = { get: jest.fn(() => 'test-key') };
  const leads = {
    exists: jest.fn().mockResolvedValue(opts.leadExists ?? true),
    find: jest
      .fn()
      .mockResolvedValue((opts.leadNumbers ?? []).map((leadNumber) => ({ leadNumber }))),
  };
  const notifications = { notifyScanReady: jest.fn().mockResolvedValue(true) };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoiceScansService(
    scans as unknown as Repository<InvoiceScan>,
    s3 as unknown as S3Service,
    config as unknown as ConfigService,
    qboApi as unknown as QuickbooksApiService,
    financials as unknown as QuickbooksFinancialsService,
    leads as unknown as Repository<Lead>,
    notifications as unknown as InvoiceScanNotificationsService,
    cache as unknown as Cache,
  );
  return {
    scan,
    scans,
    s3,
    qboApi,
    financials,
    config,
    leads,
    notifications,
    cache,
    savedStatuses,
    service,
  };
}

describe('InvoiceScansService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('scan', () => {
    it.each([
      { contentType: 'image/jpeg', fileName: 'invoice.jpg', buffer: Buffer.from('invoice-photo') },
      { contentType: 'application/pdf', fileName: 'invoice.pdf', buffer: Buffer.from('%PDF-1.7\ninvoice') },
    ])('extracts fields from $contentType, suggests QuickBooks records and notifies', async ({
      contentType,
      fileName,
      buffer,
    }) => {
      const h = harness({ scan: { contentType, fileName }, buffer });
      mockOpenAi(openAiPayload());

      const result = await h.service.scan(SCAN_ID);
      const request = (axios.post as jest.Mock).mock.calls[0][1] as {
        input: Array<{ content: Array<Record<string, unknown>> }>;
      };

      expect(result.status).toBe('needs_review');
      expect(result.extractedData).toMatchObject({
        invoiceNumber: 'INV-42',
        counterpartyName: 'Maros Customer',
        total: 120,
        lineItems: [{ description: 'Roof repair', amount: 120 }],
      });
      expect(result.qboSuggestions).toMatchObject({
        connected: true,
        transactionType: 'Invoice',
        counterparties: [{ id: 'customer-1', confidence: 100 }],
      });
      expect(h.savedStatuses).toEqual(['processing', 'needs_review']);
      expect(request.input[0].content[1]).toMatchObject(
        contentType === 'application/pdf'
          ? { type: 'input_file', filename: fileName }
          : { type: 'input_image' },
      );
      expect(h.notifications.notifyScanReady).toHaveBeenCalledWith(
        expect.objectContaining({ id: SCAN_ID, status: 'needs_review' }),
      );
    });

    it('links the project from the file name prefix when exactly one lead matches', async () => {
      const h = harness({
        scan: { fileName: '050P-Lyon Plumbing - 69.60.jpg' },
        leadNumbers: ['050P-0826', '045-0726'],
      });
      mockOpenAi(openAiPayload());

      const result = await h.service.scan(SCAN_ID);

      expect(result.projectNumber).toBe('050P-0826');
      expect(result.warnings).toEqual([]);
    });

    it('keeps the scan reviewable when a field is unreadable, QuickBooks is down and the project is unknown', async () => {
      const h = harness({ qboFails: true, leadNumbers: ['050P-0826'] });
      mockOpenAi(openAiPayload({ total: 'n/a', issue_date: 'September 1st', project_number: '999' }));

      const result = await h.service.scan(SCAN_ID);

      expect(result.status).toBe('needs_review');
      expect(result.extractedData).toMatchObject({ total: null, issueDate: null, subtotal: 120 });
      expect(result.qboSuggestions).toMatchObject({ connected: false });
      expect(result.projectNumber).toBeNull();
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Total could not be read'),
          expect.stringContaining('Issue date'),
          expect.stringContaining('QuickBooks suggestions could not be loaded'),
          expect.stringContaining('No project matched "999"'),
        ]),
      );
      expect(h.notifications.notifyScanReady).toHaveBeenCalled();
    });

    it('does not overwrite a project number the reviewer already chose', async () => {
      const h = harness({
        scan: { projectNumber: '045-0726', fileName: '050P-invoice.jpg' },
        leadNumbers: ['050P-0826'],
      });
      mockOpenAi(openAiPayload());

      const result = await h.service.scan(SCAN_ID);

      expect(result.projectNumber).toBe('045-0726');
      expect(h.leads.find).not.toHaveBeenCalled();
    });

    it('fails the scan when OpenAI returns nothing usable', async () => {
      const h = harness();
      jest.spyOn(axios, 'post').mockResolvedValue({ data: { output: [] } } as never);

      await expect(h.service.scan(SCAN_ID)).rejects.toThrow('could not be scanned');
      expect(h.scan.status).toBe('failed');
      expect(h.notifications.notifyScanReady).not.toHaveBeenCalled();
    });

    it('rejects PDF content without a PDF header', async () => {
      const openAiRequest = jest
        .spyOn(axios, 'post')
        .mockRejectedValue(new Error('Unexpected OpenAI request.'));
      const h = harness({
        scan: { contentType: 'application/pdf', fileName: 'invoice.pdf' },
        buffer: Buffer.from('not a PDF'),
      });

      await expect(h.service.scan(SCAN_ID)).rejects.toThrow('not a valid PDF');
      expect(h.scan.status).toBe('failed');
      expect(openAiRequest).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('saves a project number that matches an existing lead number', async () => {
      const h = harness({ leadExists: true });
      const result = await h.service.update(SCAN_ID, { projectNumber: ' 074P-0926 ' });
      expect(h.leads.exists).toHaveBeenCalledWith({ where: { leadNumber: '074P-0926' } });
      expect(result.projectNumber).toBe('074P-0926');
    });

    it('rejects a project number with no matching project', async () => {
      const h = harness({ leadExists: false });
      await expect(h.service.update(SCAN_ID, { projectNumber: 'NOPE' })).rejects.toThrow(
        'No project found',
      );
      expect(h.scan.projectNumber).toBeNull();
    });

    it('clears the project number when given an empty value', async () => {
      const h = harness({ scan: { projectNumber: '074P-0926' } });
      const result = await h.service.update(SCAN_ID, { projectNumber: '' });
      expect(h.leads.exists).not.toHaveBeenCalled();
      expect(result.projectNumber).toBeNull();
    });

    it('saves and clears reviewer comments', async () => {
      const h = harness();
      expect((await h.service.update(SCAN_ID, { comments: '  Missing PO  ' })).comments).toBe('Missing PO');
      expect((await h.service.update(SCAN_ID, { comments: '' })).comments).toBeNull();
    });

    it('corrects the amount, date and description of a manual transaction', async () => {
      const h = harness({
        scan: {
          recordType: 'transaction',
          fileKey: null,
          status: 'needs_review',
          extractedData: {
            direction: 'unknown',
            classification: 'other',
            counterpartyName: 'Lion Plumbing',
            invoiceNumber: null,
            issueDate: '2026-09-28',
            dueDate: null,
            currency: 'USD',
            subtotal: 69.6,
            taxTotal: null,
            total: 69.6,
            paymentStatus: 'paid',
            description: 'Materials',
            transactionDirection: 'payment_made',
            confidence: 1,
            lineItems: [],
          },
        },
      });

      const result = await h.service.update(
        SCAN_ID,
        {
          total: 870.4,
          subtotal: 870.4,
          issueDate: '2026-09-29',
          description: '  Lion Plumbing invoice  ',
          transactionDirection: 'payment_received',
        },
        { id: 7 },
      );

      expect(result.extractedData).toMatchObject({
        total: 870.4,
        subtotal: 870.4,
        issueDate: '2026-09-29',
        description: 'Lion Plumbing invoice',
        transactionDirection: 'payment_received',
      });
      // Ya estaba en needs_review: corregir a mano no debe ensuciarlo con el
      // aviso de "los datos se escribieron a mano".
      expect(result.warnings).toEqual([]);
    });

    describe('counterparty', () => {
      function linkedScan(): Harness {
        return harness({
          scan: {
            recordType: 'transaction',
            fileKey: null,
            status: 'needs_review',
            extractedData: {
              direction: 'unknown',
              classification: 'other',
              counterpartyName: 'Home Depot',
              counterpartyId: '58',
              counterpartyType: 'Vendor',
              invoiceNumber: null,
              issueDate: '2026-09-28',
              dueDate: null,
              currency: 'USD',
              subtotal: 69.6,
              taxTotal: null,
              total: 69.6,
              paymentStatus: 'paid',
              description: 'Materials',
              transactionDirection: 'payment_made',
              confidence: 1,
              lineItems: [],
            },
          },
        });
      }

      it('stores the id and type when the reviewer picks from the QuickBooks list', async () => {
        const h = harness();

        const result = await h.service.update(SCAN_ID, {
          counterpartyName: 'Anderson Family',
          counterpartyId: '7',
          counterpartyType: 'Customer',
        });

        expect(result.extractedData).toMatchObject({
          counterpartyName: 'Anderson Family',
          counterpartyId: '7',
          counterpartyType: 'Customer',
        });
      });

      // Dejar el id viejo apuntando a otro proveedor seria un cruce falso.
      it('drops a stale id when the name is renamed on its own', async () => {
        const h = linkedScan();

        const result = await h.service.update(SCAN_ID, {
          counterpartyName: 'Jose, day labourer',
        });

        expect(result.extractedData).toMatchObject({
          counterpartyName: 'Jose, day labourer',
          counterpartyId: null,
          counterpartyType: null,
        });
      });

      it('forgets the type when the id is cleared', async () => {
        const h = linkedScan();

        const result = await h.service.update(SCAN_ID, {
          counterpartyName: 'Home Depot',
          counterpartyId: null,
        });

        expect(result.extractedData).toMatchObject({
          counterpartyName: 'Home Depot',
          counterpartyId: null,
          counterpartyType: null,
        });
      });

      it('leaves the link alone when the edit is about another field', async () => {
        const h = linkedScan();

        const result = await h.service.update(SCAN_ID, { total: 70 });

        expect(result.extractedData).toMatchObject({
          counterpartyId: '58',
          counterpartyType: 'Vendor',
        });
      });
    });

    it('records the user who saved the change as the last editor', async () => {
      const h = harness();
      const result = await h.service.update(SCAN_ID, { comments: 'Checked' }, { id: 7 });
      expect(result.updatedBy).toBe(7);
    });

    it('edits extracted fields and line items without touching the rest', async () => {
      const h = harness({
        scan: {
          status: 'needs_review',
          extractedData: {
            direction: 'incoming',
            classification: 'materials_expense',
            counterpartyName: 'Lion Plumbing',
            invoiceNumber: '4022039',
            issueDate: '2026-09-01',
            dueDate: null,
            currency: 'USD',
            subtotal: 80,
            taxTotal: 7.73,
            total: 87.73,
            paymentStatus: 'unpaid',
            confidence: 0.9,
            lineItems: [{ description: 'Pipe', quantity: 1, unitPrice: 80, amount: 80 }],
          },
        },
      });

      const result = await h.service.update(SCAN_ID, {
        total: 90,
        dueDate: '2026-10-01',
        currency: 'usd',
        lineItems: [
          { description: ' Pipe ', quantity: 2, unitPrice: 40, amount: 80 },
          { description: 'Delivery', amount: 10 },
        ],
      });

      expect(result.extractedData).toMatchObject({
        counterpartyName: 'Lion Plumbing',
        total: 90,
        dueDate: '2026-10-01',
        currency: 'USD',
        subtotal: 80,
        lineItems: [
          { description: 'Pipe', quantity: 2, unitPrice: 40, amount: 80 },
          { description: 'Delivery', quantity: null, unitPrice: null, amount: 10 },
        ],
      });
      expect(result.status).toBe('needs_review');
      expect(result.warnings).toEqual([]);
    });

    it('turns a failed scan into a reviewable one when details are typed in by hand', async () => {
      const h = harness({ scan: { status: 'failed', errorMessage: 'The file could not be scanned.' } });

      const result = await h.service.update(SCAN_ID, { counterpartyName: 'Acme', total: 10 });

      expect(result.status).toBe('needs_review');
      expect(result.errorMessage).toBeNull();
      expect(result.extractedData).toMatchObject({ counterpartyName: 'Acme', total: 10, direction: 'unknown' });
      expect(result.warnings).toEqual([expect.stringContaining('entered by hand')]);
    });

    it('marks a reviewed scan as entered in QuickBooks and back to pending', async () => {
      const h = harness({ scan: { status: 'needs_review' } });

      const entered = await h.service.update(SCAN_ID, { entered: true }, { id: 11 });
      expect(entered.enteredAt).toBeInstanceOf(Date);
      expect(entered.enteredBy).toBe(11);

      const pending = await h.service.update(SCAN_ID, { entered: false }, { id: 11 });
      expect(pending.enteredAt).toBeNull();
      expect(pending.enteredBy).toBeNull();
    });

    it('refuses to mark an unscanned invoice as entered', async () => {
      const h = harness({ scan: { status: 'uploaded' } });
      await expect(h.service.update(SCAN_ID, { entered: true }, { id: 11 })).rejects.toThrow(
        'before marking it as entered',
      );
    });

    it('refuses edits while a scan is in progress', async () => {
      const h = harness({ scan: { status: 'processing' } });
      await expect(h.service.update(SCAN_ID, { total: 1 })).rejects.toThrow('being scanned');
    });
  });

  describe('list', () => {
    it('returns pending scans first, then the recently completed ones', async () => {
      const pending = baseScan({ id: 'pending' });
      const completed = baseScan({ id: 'done', enteredAt: new Date('2026-09-20T00:00:00Z') });
      const scans = {
        find: jest
          .fn()
          .mockResolvedValueOnce([pending])
          .mockResolvedValueOnce([completed]),
      };
      const service = new InvoiceScansService(
        scans as unknown as Repository<InvoiceScan>,
        {} as S3Service,
        {} as ConfigService,
        {} as QuickbooksApiService,
        {} as QuickbooksFinancialsService,
        {} as Repository<Lead>,
        {} as InvoiceScanNotificationsService,
      );

      const result = await service.list();

      expect(result.map((scan) => scan.id)).toEqual(['pending', 'done']);
      expect(result[1].enteredAt).toEqual(new Date('2026-09-20T00:00:00Z'));
      expect(result[0]).not.toHaveProperty('fileKey');
    });
  });

  describe('remove', () => {
    it('deletes the record and its stored file', async () => {
      const h = harness();

      const result = await h.service.remove(SCAN_ID);

      expect(result).toEqual({ id: SCAN_ID, deleted: true });
      expect(h.s3.deleteObject).toHaveBeenCalledWith(h.scan.fileKey);
      expect(h.scans.delete).toHaveBeenCalledWith({ id: SCAN_ID });
    });

    it('deletes a record already entered in QuickBooks', async () => {
      const h = harness({
        scan: { status: 'needs_review', enteredAt: new Date('2026-09-20T00:00:00Z') },
      });

      await expect(h.service.remove(SCAN_ID)).resolves.toEqual({
        id: SCAN_ID,
        deleted: true,
      });
    });

    it('deletes the record even when the file could not be removed', async () => {
      const h = harness();
      h.s3.deleteObject.mockRejectedValue(new Error('S3 down'));

      await expect(h.service.remove(SCAN_ID)).resolves.toMatchObject({ deleted: true });
      expect(h.scans.delete).toHaveBeenCalled();
    });

    it('refuses to delete while the file is being scanned', async () => {
      const h = harness({ scan: { status: 'processing' } });
      await expect(h.service.remove(SCAN_ID)).rejects.toThrow('being scanned');
      expect(h.scans.delete).not.toHaveBeenCalled();
    });

    it('deletes a manual transaction with no file without touching S3', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction' } });

      await h.service.remove(SCAN_ID);

      expect(h.s3.deleteObject).not.toHaveBeenCalled();
      expect(h.scans.delete).toHaveBeenCalledWith({ id: SCAN_ID });
    });
  });

  describe('getDownloadUrl', () => {
    it('signs a URL that forces the download with the stored file name', async () => {
      const h = harness();

      const result = await h.service.getDownloadUrl(SCAN_ID);

      expect(result).toEqual({ url: 'https://signed/download', fileName: 'invoice.jpg' });
      expect(h.s3.getPresignedGetUrl).toHaveBeenCalledWith(
        expect.objectContaining({ downloadFileName: 'invoice.jpg' }),
      );
    });

    it('adds an extension when the stored name has none', async () => {
      const h = harness({
        scan: { fileName: 'Lion Plumbing payment', contentType: 'application/pdf' },
      });

      const result = await h.service.getDownloadUrl(SCAN_ID);

      expect(result.fileName).toBe('Lion Plumbing payment.pdf');
    });

    it('fails when the record has no document', async () => {
      const h = harness({ scan: { fileKey: null } });
      await expect(h.service.getDownloadUrl(SCAN_ID)).rejects.toThrow(
        'no document to download',
      );
    });
  });

  describe('prepareFileAttachment and completeFileAttachment', () => {
    const file = {
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    };
    const key = `mcp/attachments/invoice-scans/${SCAN_ID}/receipt.pdf`;

    it('prepares an upload scoped to the transaction without persisting a file reference', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction', status: 'needs_review' } });

      const result = await h.service.prepareFileAttachment(SCAN_ID, file);

      expect(result).toEqual({ id: SCAN_ID, key, uploadUrl: 'https://signed/put' });
      expect(h.s3.getPresignedPutUrl).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: `invoice-scans/${SCAN_ID}` }),
      );
      expect(h.scans.save).not.toHaveBeenCalled();
      expect(h.scans.update).not.toHaveBeenCalled();
      expect(h.scan.fileKey).toBeNull();
    });

    it('finalizes only an uploaded object whose key belongs to the transaction', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction', status: 'needs_review' } });
      h.s3.getObjectMetadata.mockResolvedValue({
        contentLength: file.sizeBytes,
        contentType: file.contentType,
      });

      const result = await h.service.completeFileAttachment(
        SCAN_ID,
        { ...file, key },
        { id: 11 },
      );

      expect(h.s3.getObjectMetadata).toHaveBeenCalledWith(key);
      expect(h.scans.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: SCAN_ID }),
        expect.objectContaining({
          fileKey: key,
          fileName: file.fileName,
          contentType: file.contentType,
          updatedBy: 11,
        }),
      );
      expect(result.hasFile).toBe(true);
      expect(result.fileName).toBe(file.fileName);
    });

    it('leaves the transaction retryable when the uploaded metadata does not match', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction', status: 'needs_review' } });
      h.s3.getObjectMetadata.mockResolvedValue({
        contentLength: 17,
        contentType: file.contentType,
      });

      await expect(
        h.service.completeFileAttachment(SCAN_ID, { ...file, key }),
      ).rejects.toThrow('does not match');

      expect(h.scans.update).not.toHaveBeenCalled();
      expect(h.scan.fileKey).toBeNull();
    });

    it('treats a repeated finalize for the same key as idempotent', async () => {
      const h = harness({
        scan: {
          fileKey: key,
          fileName: file.fileName,
          contentType: file.contentType,
        },
      });

      const result = await h.service.completeFileAttachment(SCAN_ID, { ...file, key });

      expect(result.hasFile).toBe(true);
      expect(h.s3.getObjectMetadata).not.toHaveBeenCalled();
      expect(h.scans.update).not.toHaveBeenCalled();
    });

    it('rejects a key scoped to a different transaction', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction' } });
      const otherKey = 'mcp/attachments/invoice-scans/another-id/receipt.pdf';

      await expect(
        h.service.completeFileAttachment(SCAN_ID, { ...file, key: otherKey }),
      ).rejects.toThrow('does not belong to this transaction');

      expect(h.s3.getObjectMetadata).not.toHaveBeenCalled();
      expect(h.scans.update).not.toHaveBeenCalled();
    });

    it('refuses to prepare a second document', async () => {
      const h = harness({ scan: { status: 'needs_review' } });
      await expect(h.service.prepareFileAttachment(SCAN_ID, file)).rejects.toThrow(
        'already has a document',
      );
    });

    it('does not persist a reference when the object is missing from S3', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction', status: 'needs_review' } });
      h.s3.getObjectMetadata.mockRejectedValue(new Error('S3 object not found'));

      await expect(
        h.service.completeFileAttachment(SCAN_ID, { ...file, key }),
      ).rejects.toThrow('S3 object not found');

      expect(h.scans.update).not.toHaveBeenCalled();
      expect(h.scan.fileKey).toBeNull();
    });

    it('returns the attachment when a concurrent request already finalized the same key', async () => {
      const h = harness({ scan: { fileKey: null, recordType: 'transaction', status: 'needs_review' } });
      h.s3.getObjectMetadata.mockResolvedValue({
        contentLength: file.sizeBytes,
        contentType: file.contentType,
      });
      h.scans.update.mockImplementationOnce(() => {
        Object.assign(h.scan, {
          fileKey: key,
          fileName: file.fileName,
          contentType: file.contentType,
        });
        return Promise.resolve({ affected: 0 });
      });

      const result = await h.service.completeFileAttachment(SCAN_ID, { ...file, key });

      expect(result.hasFile).toBe(true);
      expect(h.scans.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('createManualTransaction', () => {
    const input = {
      description: 'Deposit for the Smith roof',
      direction: 'payment_received' as const,
      transactionDate: '2026-09-30',
      amount: 1500,
    };

    it('records the editor when a person creates it', async () => {
      const h = harness();

      await h.service.createManualTransaction(input, { id: 7 });

      expect(h.scans.create).toHaveBeenCalledWith(
        expect.objectContaining({ recordType: 'transaction', updatedBy: 7 }),
      );
    });

    // El MCP se autentica con un token compartido, no con la sesion de una
    // persona: no hay a quien atribuir la escritura y el campo queda nulo. Sin
    // esto, `actor.id` reventaba con "cannot read properties of undefined".
    it('leaves the editor empty when there is no actor, as the MCP has none', async () => {
      const h = harness();

      await h.service.createManualTransaction(input);

      expect(h.scans.create).toHaveBeenCalledWith(
        expect.objectContaining({ updatedBy: null }),
      );
    });

    it('refuses a project number that does not exist', async () => {
      const h = harness({ leadExists: false });

      await expect(
        h.service.createManualTransaction({ ...input, projectNumber: '999-9999' }),
      ).rejects.toThrow('No project found with number 999-9999');
    });

    it('keeps the QuickBooks id and type when the counterparty came from the list', async () => {
      const h = harness();

      const created = await h.service.createManualTransaction({
        ...input,
        counterpartyName: 'Home Depot',
        counterpartyId: '58',
        counterpartyType: 'Vendor',
      });

      expect(created.extractedData).toMatchObject({
        counterpartyName: 'Home Depot',
        counterpartyId: '58',
        counterpartyType: 'Vendor',
      });
    });

    // Un pago en efectivo a quien no esta dado de alta sigue siendo un apunte
    // valido: se guarda el nombre tal cual y sin id.
    it('accepts a counterparty typed by hand with no QuickBooks id', async () => {
      const h = harness();

      const created = await h.service.createManualTransaction({
        ...input,
        counterpartyName: '  Jose, day labourer  ',
      });

      expect(created.extractedData).toMatchObject({
        counterpartyName: 'Jose, day labourer',
        counterpartyId: null,
        counterpartyType: null,
      });
    });

    it('drops an id that arrives without a name', async () => {
      const h = harness();

      const created = await h.service.createManualTransaction({
        ...input,
        counterpartyId: '58',
        counterpartyType: 'Vendor',
      });

      expect(created.extractedData).toMatchObject({
        counterpartyName: null,
        counterpartyId: null,
        counterpartyType: null,
      });
    });
  });

  describe('listQboCounterparties', () => {
    function counterpartyHarness(
      vendors: unknown[],
      customers: unknown[],
    ): Harness {
      const h = harness();
      h.qboApi.queryAll.mockImplementation((_realmId: string, entity: string) =>
        Promise.resolve(entity === 'Vendor' ? vendors : customers),
      );
      return h;
    }

    it('merges active vendors and customers into one sorted, typed list', async () => {
      const h = counterpartyHarness(
        [
          { Id: '58', DisplayName: 'Home Depot' },
          { Id: '61', CompanyName: 'Zeta Plumbing' },
        ],
        [{ Id: '7', DisplayName: 'Anderson Family' }],
      );

      const result = await h.service.listQboCounterparties();

      expect(result).toEqual({
        connected: true,
        counterparties: [
          { id: '7', name: 'Anderson Family', type: 'Customer' },
          { id: '58', name: 'Home Depot', type: 'Vendor' },
          { id: '61', name: 'Zeta Plumbing', type: 'Vendor' },
        ],
      });
      expect(h.cache.set).toHaveBeenCalledWith(
        'invoice-scans:qbo-counterparties',
        result,
        10 * 60 * 1000,
      );
    });

    it('answers from the cache without calling QuickBooks again', async () => {
      const h = counterpartyHarness([{ Id: '58', DisplayName: 'Home Depot' }], []);
      const cached = {
        connected: true,
        counterparties: [{ id: '1', name: 'Cached Vendor', type: 'Vendor' as const }],
      };
      h.cache.get.mockResolvedValue(cached);

      await expect(h.service.listQboCounterparties()).resolves.toEqual(cached);
      expect(h.qboApi.queryAll).not.toHaveBeenCalled();
    });

    // El selector no puede quedarse en blanco porque QuickBooks este caido: se
    // dice que no hay conexion y el campo sigue aceptando texto escrito.
    it('reports no connection instead of failing, and does not cache the failure', async () => {
      const h = harness({ qboFails: true });

      await expect(h.service.listQboCounterparties()).resolves.toEqual({
        connected: false,
        counterparties: [],
      });
      expect(h.cache.set).not.toHaveBeenCalled();
    });

    it('returns an empty list when the company has no vendors or customers yet', async () => {
      const h = counterpartyHarness([], []);

      await expect(h.service.listQboCounterparties()).resolves.toEqual({
        connected: true,
        counterparties: [],
      });
    });

    it('skips records with no usable id or name', async () => {
      const h = counterpartyHarness(
        [{ Id: '58' }, { DisplayName: 'No id' }, null],
        [{ Id: '7', DisplayName: 'Anderson Family' }],
      );

      const { counterparties } = await h.service.listQboCounterparties();

      expect(counterparties).toEqual([
        { id: '7', name: 'Anderson Family', type: 'Customer' },
      ]);
    });
  });
});
