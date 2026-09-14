import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { CreateInvoiceScanDto } from '../dto/create-invoice-scan.dto';
import {
  ExtractedInvoiceData,
  InvoiceScan,
} from '../entities/invoice-scan.entity';
import { QuickbooksApiService } from './core/quickbooks-api.service';
import { QuickbooksFinancialsService } from './financials/quickbooks-financials.service';
import { normalizeCompanyName, nameSimilarity } from './vendor/quickbooks-vendor-matching.utils';
import { S3Service } from '../../s3/services/s3.service';

const SUPPORTED_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const PDF_HEADER = Buffer.from('%PDF-');

const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'direction',
    'classification',
    'counterparty_name',
    'invoice_number',
    'issue_date',
    'due_date',
    'currency',
    'subtotal',
    'tax_total',
    'total',
    'payment_status',
    'confidence',
    'line_items',
  ],
  properties: {
    direction: {
      type: 'string',
      enum: ['outgoing', 'incoming', 'unknown'],
    },
    classification: {
      type: 'string',
      enum: [
        'customer_service',
        'materials_expense',
        'subcontractor_expense',
        'other',
        'unknown',
      ],
    },
    counterparty_name: { type: ['string', 'null'] },
    invoice_number: { type: ['string', 'null'] },
    issue_date: { type: ['string', 'null'] },
    due_date: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'] },
    subtotal: { type: ['number', 'null'] },
    tax_total: { type: ['number', 'null'] },
    total: { type: ['number', 'null'] },
    payment_status: {
      type: 'string',
      enum: ['paid', 'unpaid', 'unknown'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unit_price', 'amount'],
        properties: {
          description: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
        },
      },
    },
  },
} as const;

type QboRecord = Record<string, unknown>;
type InvoiceScanView = Omit<InvoiceScan, 'fileKey'>;

@Injectable()
export class InvoiceScansService {
  private readonly logger = new Logger(InvoiceScansService.name);

  constructor(
    @InjectRepository(InvoiceScan)
    private readonly scans: Repository<InvoiceScan>,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    private readonly qboApi: QuickbooksApiService,
    private readonly financials: QuickbooksFinancialsService,
  ) {}

  async list(): Promise<InvoiceScanView[]> {
    const scans = await this.scans.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return scans.map((scan) => this.toPublicScan(scan));
  }

  async get(
    id: string,
  ): Promise<InvoiceScanView & { imageUrl: string }> {
    const scan = await this.findScan(id);
    const image = await this.s3.getPresignedGetUrl({
      key: scan.fileKey,
      expiresInSeconds: 900,
    });
    return { ...this.toPublicScan(scan), imageUrl: image.url };
  }

  async create(
    input: CreateInvoiceScanDto,
  ): Promise<{ id: string; uploadUrl: string }> {
    if (!SUPPORTED_FILE_TYPES.has(input.contentType)) {
      throw new BadRequestException('Use a JPG, PNG, WebP, or PDF invoice file.');
    }

    const maxUploadBytes = this.s3.getUploadRules().maxUploadBytes;
    if (input.sizeBytes < 1 || input.sizeBytes > maxUploadBytes) {
      throw new BadRequestException(
        `The invoice file must be smaller than ${Math.floor(maxUploadBytes / 1024 / 1024)} MB.`,
      );
    }

    const upload = await this.s3.getPresignedPutUrl({
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      prefix: 'invoice-scans',
    });
    const scan = this.scans.create({
      id: randomUUID(),
      fileKey: upload.key,
      fileName: input.fileName,
      contentType: input.contentType,
      status: 'uploaded',
      qboSuggestions: {},
      errorMessage: null,
      extractedData: null,
    });
    await this.scans.save(scan);

    return { id: scan.id, uploadUrl: upload.url };
  }

  async scan(id: string): Promise<InvoiceScanView> {
    const scan = await this.findScan(id);
    if (scan.status === 'processing') {
      throw new ConflictException('This invoice is already being scanned.');
    }
    if (scan.status !== 'uploaded' && scan.status !== 'failed') {
      throw new ConflictException('This invoice has already been scanned.');
    }

    scan.status = 'processing';
    scan.errorMessage = null;
    await this.scans.save(scan);

    try {
      const metadata = await this.s3.getObjectMetadata(scan.fileKey);
      if (
        !metadata.contentLength ||
        metadata.contentLength > this.s3.getUploadRules().maxUploadBytes
      ) {
        throw new BadRequestException('The uploaded invoice file is empty or too large.');
      }
      if (!SUPPORTED_FILE_TYPES.has(metadata.contentType ?? '')) {
        throw new BadRequestException('The uploaded invoice file format is unsupported.');
      }
      const photo = await this.s3.getObjectBuffer(scan.fileKey);
      if (!photo.buffer.length || photo.buffer.length > metadata.contentLength) {
        throw new BadRequestException('The uploaded invoice file is empty or unsupported.');
      }
      const contentType = photo.contentType ?? metadata.contentType ?? scan.contentType;
      if (!SUPPORTED_FILE_TYPES.has(contentType)) {
        throw new BadRequestException('The uploaded invoice file format is unsupported.');
      }
      if (
        contentType === 'application/pdf' &&
        !photo.buffer.subarray(0, 1024).includes(PDF_HEADER)
      ) {
        throw new BadRequestException('The uploaded file is not a valid PDF.');
      }

      const extracted = await this.extractInvoice(
        photo.buffer,
        contentType,
        photo.fileName,
      );
      const suggestions = await this.getQboSuggestions(extracted);

      scan.extractedData = extracted;
      scan.qboSuggestions = suggestions;
      scan.status = 'needs_review';
      return this.toPublicScan(await this.scans.save(scan));
    } catch (error) {
      scan.status = 'failed';
      scan.errorMessage =
        error instanceof BadRequestException
          ? error.message
          : 'The invoice file could not be scanned. Try again with a clearer file.';
      await this.scans.save(scan);
      this.logger.warn(`Invoice scan ${id} failed`);

      if (error instanceof BadRequestException) throw error;
      if (error instanceof ServiceUnavailableException) throw error;
      throw new InternalServerErrorException(scan.errorMessage);
    }
  }

  private async findScan(id: string): Promise<InvoiceScan> {
    const scan = await this.scans.findOne({ where: { id } });
    if (!scan) throw new NotFoundException('Invoice scan not found.');
    return scan;
  }

  private toPublicScan(scan: InvoiceScan): InvoiceScanView {
    return {
      id: scan.id,
      fileName: scan.fileName,
      contentType: scan.contentType,
      status: scan.status,
      extractedData: scan.extractedData,
      qboSuggestions: scan.qboSuggestions,
      errorMessage: scan.errorMessage,
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
    };
  }

  private async extractInvoice(
    buffer: Buffer,
    contentType: string,
    fileName: string,
  ): Promise<ExtractedInvoiceData> {
    const apiKey = this.config.get<string>('OPENAI_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Invoice scanning is not configured on the server.',
      );
    }

    try {
      const response = await axios.post<{
        output?: Array<{
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>;
      }>(
        'https://api.openai.com/v1/responses',
        {
          model: 'gpt-4.1-mini',
          store: false,
          instructions:
            'Extract invoice facts visible in the image or PDF. Never invent values; use null for unreadable or missing fields. Dates must be YYYY-MM-DD. Direction is outgoing when Maros Construction issued a customer invoice, incoming when a supplier issued a bill to Maros, otherwise unknown. Classify incoming materials vs subcontractor expenses only when the line items make that clear; use unknown otherwise. Return line items as printed.',
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Read this invoice and return the requested fields.',
                },
                contentType === 'application/pdf'
                  ? {
                      type: 'input_file',
                      filename: fileName,
                      file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
                      detail: 'high',
                    }
                  : {
                      type: 'input_image',
                      image_url: `data:${contentType};base64,${buffer.toString('base64')}`,
                      detail: 'high',
                    },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'invoice_extraction',
              strict: true,
              schema: INVOICE_SCHEMA,
            },
          },
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 60_000,
        },
      );

      const text = response.data.output
        ?.filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .find((content) => content.type === 'output_text')?.text;
      if (!text) throw new Error('OpenAI returned no structured invoice data.');

      const parsed = JSON.parse(text) as {
        direction: ExtractedInvoiceData['direction'];
        classification: ExtractedInvoiceData['classification'];
        counterparty_name: string | null;
        invoice_number: string | null;
        issue_date: string | null;
        due_date: string | null;
        currency: string | null;
        subtotal: number | null;
        tax_total: number | null;
        total: number | null;
        payment_status: ExtractedInvoiceData['paymentStatus'];
        confidence: number;
        line_items: Array<{
          description: string;
          quantity: number | null;
          unit_price: number | null;
          amount: number | null;
        }>;
      };

      return {
        direction: parsed.direction,
        classification: parsed.classification,
        counterpartyName: parsed.counterparty_name,
        invoiceNumber: parsed.invoice_number,
        issueDate: parsed.issue_date,
        dueDate: parsed.due_date,
        currency: parsed.currency,
        subtotal: parsed.subtotal,
        taxTotal: parsed.tax_total,
        total: parsed.total,
        paymentStatus: parsed.payment_status,
        confidence: parsed.confidence,
        lineItems: parsed.line_items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          amount: item.amount,
        })),
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new InternalServerErrorException(
        'The invoice file could not be scanned. Try again with a clearer file.',
      );
    }
  }

  private async getQboSuggestions(
    invoice: ExtractedInvoiceData,
  ): Promise<Record<string, unknown>> {
    try {
      const realmId = await this.financials.getDefaultRealmId();
      const outgoing = invoice.direction === 'outgoing';
      const incoming = invoice.direction === 'incoming';
      const [customers, accounts, services, vendors] = await Promise.all([
        outgoing || !incoming
          ? this.qboApi.queryAll(realmId, 'Customer', {
              select: 'Id, DisplayName, CompanyName, Active',
              where: 'Active = true',
              maxPages: 5,
            })
          : Promise.resolve([]),
        incoming || !outgoing
          ? this.qboApi.queryAll(realmId, 'Account', {
              select: 'Id, Name, AccountType, Active',
              where: 'Active = true',
              maxPages: 5,
            })
          : Promise.resolve([]),
        outgoing || !incoming
          ? this.qboApi.queryAll(realmId, 'Item', {
              select: 'Id, Name, Type, Active',
              where: "Type = 'Service' AND Active = true",
              maxPages: 5,
            })
          : Promise.resolve([]),
        incoming || !outgoing
          ? this.qboApi.queryAll(realmId, 'Vendor', {
              select: 'Id, DisplayName, CompanyName, Active',
              where: 'Active = true',
              maxPages: 5,
            })
          : Promise.resolve([]),
      ]);
      const candidateRecords = outgoing
        ? customers
        : incoming
          ? vendors
          : [...customers, ...vendors];
      const matches = this.rankMatches(candidateRecords, invoice.counterpartyName);
      const accountMatches = this.rankAccounts(accounts, invoice.classification);
      const serviceItems = this.rankServiceItems(services, invoice.lineItems);

      return {
        connected: true,
        suggestionOnly: true,
        transactionType: outgoing
          ? 'Invoice'
          : incoming
            ? invoice.paymentStatus === 'paid'
              ? 'Purchase'
              : 'Bill'
            : null,
        counterpartyType: outgoing
          ? 'Customer'
          : incoming
            ? 'Vendor'
            : 'Customer or Vendor',
        counterparties: matches,
        expenseAccounts: accountMatches,
        serviceItems,
      };
    } catch {
      this.logger.warn('Could not load QuickBooks invoice suggestions');
      return {
        connected: false,
        suggestionOnly: true,
        transactionType: null,
        counterpartyType: null,
        counterparties: [],
        expenseAccounts: [],
        serviceItems: [],
      };
    }
  }

  private rankMatches(
    records: unknown[],
    counterpartyName: string | null,
  ): Array<{ id: string; name: string; confidence: number }> {
    if (!counterpartyName) return [];
    const source = normalizeCompanyName(counterpartyName);
    return records
      .map((value) => this.asRecord(value))
      .filter((record): record is QboRecord => record !== null)
      .map((record) => {
        const name = String(record.DisplayName ?? record.CompanyName ?? '');
        return {
          id: String(record.Id ?? ''),
          name,
          confidence: nameSimilarity(source, normalizeCompanyName(name)),
        };
      })
      .filter((candidate) => candidate.id && candidate.name && candidate.confidence >= 0.35)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map((candidate) => ({
        ...candidate,
        confidence: Math.round(candidate.confidence * 100),
      }));
  }

  private rankAccounts(
    records: unknown[],
    classification: ExtractedInvoiceData['classification'],
  ): Array<{ id: string; name: string }> {
    const terms =
      classification === 'materials_expense'
        ? ['material', 'supply', 'supplies', 'lumber']
        : classification === 'subcontractor_expense'
          ? ['subcontract', 'sub-contractor']
          : ['material', 'supply', 'subcontract'];
    return records
      .map((value) => this.asRecord(value))
      .filter((record): record is QboRecord => record !== null)
      .map((record) => ({
        id: String(record.Id ?? ''),
        name: String(record.Name ?? ''),
      }))
      .filter(
        (account) =>
          account.id &&
          account.name &&
          terms.some((term) => account.name.toLowerCase().includes(term)),
      )
      .slice(0, 10);
  }

  private rankServiceItems(
    records: unknown[],
    lineItems: ExtractedInvoiceData['lineItems'],
  ): Array<{ id: string; name: string }> {
    if (lineItems.length === 0) return [];
    const descriptions = lineItems.map((line) =>
      normalizeCompanyName(line.description),
    );
    return records
      .map((value) => this.asRecord(value))
      .filter(
        (item): item is QboRecord => item !== null && item.Type === 'Service',
      )
      .map((item) => {
        const name = String(item.Name ?? '');
        const normalizedName = normalizeCompanyName(name);
        const confidence = Math.max(
          ...descriptions.map((description) =>
            nameSimilarity(description, normalizedName),
          ),
        );
        return { id: String(item.Id ?? ''), name, confidence };
      })
      .filter((item) => item.id && item.name && item.confidence >= 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8)
      .map(({ id, name }) => ({ id, name }));
  }

  private asRecord(value: unknown): QboRecord | null {
    return value !== null && typeof value === 'object'
      ? (value as QboRecord)
      : null;
  }
}
