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
import { IsNull, Not, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CreateInvoiceScanDto } from '../dto/create-invoice-scan.dto';
import { UpdateInvoiceScanDto } from '../dto/update-invoice-scan.dto';
import { Lead } from '../../../entities/lead.entity';
import {
  emptyExtractedInvoice,
  parseInvoiceExtraction,
} from './invoice-scans/invoice-extraction.parser';
import {
  projectNumberCandidates,
  resolveProjectNumber,
} from './invoice-scans/invoice-project-number';
import { InvoiceScanNotificationsService } from './invoice-scans/invoice-scan-notifications.service';
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
    'project_number',
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
    project_number: { type: ['string', 'null'] },
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
type InvoiceScanView = Omit<InvoiceScan, 'fileKey' | 'notifiedAt' | 'remindedAt'>;

const MANUAL_ENTRY_WARNING =
  'Details were entered by hand because the automatic scan did not complete.';
const QBO_UNAVAILABLE_WARNING =
  'QuickBooks suggestions could not be loaded; match the customer or vendor by hand.';
const PENDING_LIST_LIMIT = 200;
const COMPLETED_LIST_LIMIT = 50;

const EDITABLE_FIELDS = [
  'direction',
  'classification',
  'counterpartyName',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'currency',
  'subtotal',
  'taxTotal',
  'total',
  'paymentStatus',
  'lineItems',
] as const;

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
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    private readonly notifications: InvoiceScanNotificationsService,
  ) {}

  /** Every pending scan plus the most recently completed ones. */
  async list(): Promise<InvoiceScanView[]> {
    const [pending, completed] = await Promise.all([
      this.scans.find({
        where: { enteredAt: IsNull() },
        order: { createdAt: 'DESC' },
        take: PENDING_LIST_LIMIT,
      }),
      this.scans.find({
        where: { enteredAt: Not(IsNull()) },
        order: { enteredAt: 'DESC' },
        take: COMPLETED_LIST_LIMIT,
      }),
    ]);
    return [...pending, ...completed].map((scan) => this.toPublicScan(scan));
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
      projectNumber: null,
      warnings: [],
      enteredAt: null,
      enteredBy: null,
      updatedBy: null,
      comments: null,
      notifiedAt: null,
      remindedAt: null,
    });
    await this.scans.save(scan);

    return { id: scan.id, uploadUrl: upload.url };
  }

  async update(
    id: string,
    input: UpdateInvoiceScanDto,
    actor?: Pick<AuthenticatedUser, 'id'>,
  ): Promise<InvoiceScanView> {
    const scan = await this.findScan(id);
    if (scan.status === 'processing') {
      throw new ConflictException('This invoice is being scanned; try again in a moment.');
    }

    if (input.projectNumber !== undefined) {
      const projectNumber = input.projectNumber?.trim() || null;
      if (
        projectNumber &&
        !(await this.leads.exists({ where: { leadNumber: projectNumber } }))
      ) {
        throw new BadRequestException(`No project found with number ${projectNumber}.`);
      }
      scan.projectNumber = projectNumber;
    }

    if (input.comments !== undefined) {
      scan.comments = input.comments?.trim() || null;
    }

    const edited = EDITABLE_FIELDS.filter((field) => input[field] !== undefined);
    if (edited.length > 0) {
      const next = { ...(scan.extractedData ?? emptyExtractedInvoice()) };
      for (const field of edited) {
        switch (field) {
          case 'direction':
            next.direction = input.direction!;
            break;
          case 'classification':
            next.classification = input.classification!;
            break;
          case 'paymentStatus':
            next.paymentStatus = input.paymentStatus!;
            break;
          case 'counterpartyName':
          case 'invoiceNumber':
          case 'issueDate':
          case 'dueDate':
            next[field] = input[field]?.trim() || null;
            break;
          case 'currency':
            next.currency = input.currency?.trim().toUpperCase() || null;
            break;
          case 'subtotal':
          case 'taxTotal':
          case 'total':
            next[field] = input[field] ?? null;
            break;
          case 'lineItems':
            next.lineItems = (input.lineItems ?? []).map((line) => ({
              description: line.description.trim(),
              quantity: line.quantity ?? null,
              unitPrice: line.unitPrice ?? null,
              amount: line.amount ?? null,
            }));
            break;
        }
      }
      scan.extractedData = next;
      if (scan.status !== 'needs_review') {
        // A reviewer typing the details in is as good as a successful scan.
        scan.status = 'needs_review';
        scan.errorMessage = null;
        scan.warnings = this.addWarning(scan.warnings, MANUAL_ENTRY_WARNING);
      }
    }

    if (input.entered !== undefined) {
      if (input.entered && scan.status !== 'needs_review') {
        throw new BadRequestException(
          'Scan the invoice or enter its details before marking it as entered.',
        );
      }
      scan.enteredAt = input.entered ? new Date() : null;
      scan.enteredBy = input.entered ? (actor?.id ?? null) : null;
    }

    // Whoever saves a change is recorded as the last editor.
    if (actor?.id) scan.updatedBy = actor.id;

    return this.toPublicScan(await this.scans.save(scan));
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
    scan.warnings = [];
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

      // From here on nothing is fatal: a field we cannot read, QuickBooks being
      // down or an unknown project number become warnings for the reviewer.
      const extraction = await this.extractInvoice(
        photo.buffer,
        contentType,
        photo.fileName,
      );
      const warnings = [...extraction.warnings];

      const suggestions = await this.getQboSuggestions(extraction.data);
      if (suggestions.connected === false) warnings.push(QBO_UNAVAILABLE_WARNING);

      if (!scan.projectNumber) {
        const resolution = await this.resolveProjectNumber(
          extraction.projectNumberHint,
          scan.fileName,
        );
        scan.projectNumber = resolution.projectNumber;
        if (resolution.warning) warnings.push(resolution.warning);
      }

      scan.extractedData = extraction.data;
      scan.qboSuggestions = suggestions;
      scan.warnings = warnings;
      scan.status = 'needs_review';
      const saved = await this.scans.save(scan);
      // Fire-and-forget: the reviewer's response must not wait on SMTP.
      void this.notifications.notifyScanReady(saved);
      return this.toPublicScan(saved);
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
      projectNumber: scan.projectNumber,
      comments: scan.comments ?? null,
      warnings: scan.warnings ?? [],
      enteredAt: scan.enteredAt ?? null,
      enteredBy: scan.enteredBy ?? null,
      updatedBy: scan.updatedBy ?? null,
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
    };
  }

  private addWarning(warnings: string[] | null | undefined, warning: string): string[] {
    const current = warnings ?? [];
    return current.includes(warning) ? current : [...current, warning];
  }

  private async resolveProjectNumber(
    hint: string | null,
    fileName: string,
  ): Promise<{ projectNumber: string | null; warning: string | null }> {
    const candidates = projectNumberCandidates({ extracted: hint, fileName });
    if (candidates.length === 0) return resolveProjectNumber([], []);
    try {
      const leads = await this.leads.find({
        select: { leadNumber: true },
        where: { leadNumber: Not(IsNull()) },
      });
      return resolveProjectNumber(
        candidates,
        leads.map((lead) => lead.leadNumber).filter((value): value is string => !!value),
      );
    } catch (error) {
      this.logger.warn(
        `Could not load lead numbers to match invoice project: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        projectNumber: null,
        warning: 'The project could not be matched automatically; pick it manually.',
      };
    }
  }

  private async extractInvoice(
    buffer: Buffer,
    contentType: string,
    fileName: string,
  ): Promise<ReturnType<typeof parseInvoiceExtraction>> {
    const apiKey =
      this.config.get<string>('OPENAI_KEY') ||
      this.config.get<string>('OPENAI_API_KEY');
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
            'Extract invoice facts visible in the image or PDF. Never invent values; use null for unreadable or missing fields. Dates must be YYYY-MM-DD. Direction is outgoing when Maros Construction issued a customer invoice, incoming when a supplier issued a bill to Maros, otherwise unknown. Classify incoming materials vs subcontractor expenses only when the line items make that clear; use unknown otherwise. Return line items as printed. project_number is the Maros job or project reference printed on the document (formats like 050P, 045, 050P-0826), or null when none is printed.',
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('OpenAI returned malformed invoice JSON.');
      }
      return parseInvoiceExtraction(parsed);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new InternalServerErrorException(
        'The invoice file could not be scanned. Try again with a clearer file.',
      );
    }
  }

  private async getQboSuggestions(
    invoice: ExtractedInvoiceData,
  ): Promise<Record<string, unknown> & { connected: boolean }> {
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
