import axios from 'axios';
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
  scans: { findOne: jest.Mock; save: jest.Mock };
  s3: Record<string, jest.Mock>;
  qboApi: { queryAll: jest.Mock };
  financials: { getDefaultRealmId: jest.Mock };
  config: { get: jest.Mock };
  leads: { exists: jest.Mock; find: jest.Mock };
  notifications: { notifyScanReady: jest.Mock };
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
    save: jest.fn().mockImplementation((value: InvoiceScan) => {
      savedStatuses.push(value.status);
      return Promise.resolve(value);
    }),
  };
  const s3 = {
    getObjectMetadata: jest.fn().mockResolvedValue({
      contentLength: 100,
      contentType: scan.contentType,
    }),
    getUploadRules: jest.fn().mockReturnValue({ maxUploadBytes: 5 * 1024 * 1024 }),
    getObjectBuffer: jest.fn().mockResolvedValue({
      buffer: opts.buffer ?? Buffer.from('invoice-photo'),
      contentType: scan.contentType,
      fileName: scan.fileName,
    }),
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
  const service = new InvoiceScansService(
    scans as unknown as Repository<InvoiceScan>,
    s3 as unknown as S3Service,
    config as unknown as ConfigService,
    qboApi as unknown as QuickbooksApiService,
    financials as unknown as QuickbooksFinancialsService,
    leads as unknown as Repository<Lead>,
    notifications as unknown as InvoiceScanNotificationsService,
  );
  return { scan, scans, s3, qboApi, financials, config, leads, notifications, savedStatuses, service };
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
});
