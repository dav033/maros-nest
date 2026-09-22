import axios from 'axios';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { S3Service } from '../../s3/services/s3.service';
import { InvoiceScan } from '../entities/invoice-scan.entity';
import { Lead } from '../../../entities/lead.entity';
import { QuickbooksApiService } from './core/quickbooks-api.service';
import { QuickbooksFinancialsService } from './financials/quickbooks-financials.service';
import { InvoiceScansService } from './invoice-scans.service';

describe('InvoiceScansService', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      contentType: 'image/jpeg',
      fileName: 'invoice.jpg',
      buffer: Buffer.from('invoice-photo'),
    },
    {
      contentType: 'application/pdf',
      fileName: 'invoice.pdf',
      buffer: Buffer.from('%PDF-1.7\ninvoice'),
    },
  ])('extracts invoice fields from $contentType and suggests QuickBooks records', async ({
    contentType,
    fileName,
    buffer,
  }) => {
    const scan = {
      id: '8c81e542-2141-4ba4-b4f4-fb442eb2fafe',
      fileKey: 'mcp/attachments/invoice-scans/invoice.jpg',
      fileName,
      contentType,
      status: 'uploaded',
      extractedData: null,
      qboSuggestions: {},
      errorMessage: null,
      createdAt: new Date('2026-09-12T12:00:00Z'),
      updatedAt: new Date('2026-09-12T12:00:00Z'),
    } as InvoiceScan;
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
        contentType,
      }),
      getUploadRules: jest.fn().mockReturnValue({ maxUploadBytes: 5 * 1024 * 1024 }),
      getObjectBuffer: jest.fn().mockResolvedValue({
        buffer,
        contentType,
        fileName,
      }),
    };
    const qboApi = {
      queryAll: jest.fn((realmId: string, entity: string) => {
        if (realmId !== 'realm-1') return Promise.resolve([]);
        if (entity === 'Customer') {
          return Promise.resolve([{ Id: 'customer-1', DisplayName: 'Maros Customer' }]);
        }
        return Promise.resolve([]);
      }),
    };
    const financials = {
      getDefaultRealmId: jest.fn().mockResolvedValue('realm-1'),
    };
    const config = {
      get: jest.fn((name: string) => {
        if (name === 'OPENAI_KEY' && contentType === 'application/pdf') {
          return undefined;
        }
        return 'test-key';
      }),
    };
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
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
                  line_items: [
                    {
                      description: 'Roof repair',
                      quantity: 1,
                      unit_price: 120,
                      amount: 120,
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    } as never);

    const service = new InvoiceScansService(
      scans as unknown as Repository<InvoiceScan>,
      s3 as unknown as S3Service,
      config as ConfigService,
      qboApi as unknown as QuickbooksApiService,
      financials as unknown as QuickbooksFinancialsService,
      {} as Repository<Lead>,
    );

    const result = await service.scan(scan.id);
    const request = (axios.post as jest.Mock).mock.calls[0][1] as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
    };

    expect(result.status).toBe('needs_review');
    if (contentType === 'application/pdf') {
      expect(config.get).toHaveBeenCalledWith('OPENAI_API_KEY');
    }
    expect(result.extractedData).toMatchObject({
      invoiceNumber: 'INV-42',
      counterpartyName: 'Maros Customer',
      total: 120,
      lineItems: [{ description: 'Roof repair', amount: 120 }],
    });
    expect(result.qboSuggestions).toMatchObject({
      connected: true,
      suggestionOnly: true,
      transactionType: 'Invoice',
      counterparties: [{ id: 'customer-1', confidence: 100 }],
    });
    expect(savedStatuses).toEqual(['processing', 'needs_review']);
    expect(request.input[0].content[1]).toMatchObject(
      contentType === 'application/pdf'
        ? {
            type: 'input_file',
            filename: fileName,
            file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
          }
        : {
            type: 'input_image',
            image_url: `data:${contentType};base64,${buffer.toString('base64')}`,
          },
    );
    expect(qboApi.queryAll).toHaveBeenCalledWith(
      'realm-1',
      'Customer',
      expect.objectContaining({ where: 'Active = true' }),
    );
  });

  it('rejects PDF content without a PDF header', async () => {
    const openAiRequest = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('Unexpected OpenAI request.'));
    const scan = {
      id: '8c81e542-2141-4ba4-b4f4-fb442eb2fafe',
      fileKey: 'mcp/attachments/invoice-scans/invoice.pdf',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      status: 'uploaded',
    } as InvoiceScan;
    const scans = {
      findOne: jest.fn().mockResolvedValue(scan),
      save: jest.fn().mockImplementation((value: InvoiceScan) => Promise.resolve(value)),
    };
    const s3 = {
      getObjectMetadata: jest.fn().mockResolvedValue({
        contentLength: 100,
        contentType: 'application/pdf',
      }),
      getUploadRules: jest.fn().mockReturnValue({ maxUploadBytes: 5 * 1024 * 1024 }),
      getObjectBuffer: jest.fn().mockResolvedValue({
        buffer: Buffer.from('not a PDF'),
        contentType: 'application/pdf',
        fileName: 'invoice.pdf',
      }),
    };
    const service = new InvoiceScansService(
      scans as unknown as Repository<InvoiceScan>,
      s3 as unknown as S3Service,
      {} as ConfigService,
      {} as QuickbooksApiService,
      {} as QuickbooksFinancialsService,
      {} as Repository<Lead>,
    );

    await expect(service.scan(scan.id)).rejects.toThrow('not a valid PDF');
    expect(scan.status).toBe('failed');
    expect(openAiRequest).not.toHaveBeenCalled();
  });

  describe('update', () => {
    const makeService = (leadExists: boolean) => {
      const scan = { id: 'scan-1', projectNumber: null } as unknown as InvoiceScan;
      const scans = {
        findOne: jest.fn().mockResolvedValue(scan),
        save: jest.fn((value: InvoiceScan) => Promise.resolve(value)),
      };
      const leads = { exists: jest.fn().mockResolvedValue(leadExists) };
      const service = new InvoiceScansService(
        scans as unknown as Repository<InvoiceScan>,
        {} as S3Service,
        {} as ConfigService,
        {} as QuickbooksApiService,
        {} as QuickbooksFinancialsService,
        leads as unknown as Repository<Lead>,
      );
      return { service, scan, leads };
    };

    it('saves a project number that matches an existing lead number', async () => {
      const { service, leads } = makeService(true);
      const result = await service.update('scan-1', { projectNumber: ' 074P-0926 ' });
      expect(leads.exists).toHaveBeenCalledWith({ where: { leadNumber: '074P-0926' } });
      expect(result.projectNumber).toBe('074P-0926');
    });

    it('rejects a project number with no matching project', async () => {
      const { service, scan } = makeService(false);
      await expect(service.update('scan-1', { projectNumber: 'NOPE' })).rejects.toThrow('No project found');
      expect(scan.projectNumber).toBeNull();
    });

    it('clears the project number when given an empty value', async () => {
      const { service, scan, leads } = makeService(true);
      scan.projectNumber = '074P-0926';
      const result = await service.update('scan-1', { projectNumber: '' });
      expect(leads.exists).not.toHaveBeenCalled();
      expect(result.projectNumber).toBeNull();
    });
  });
});
