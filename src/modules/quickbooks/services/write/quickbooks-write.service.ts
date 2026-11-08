import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { InvoiceScan } from '../../entities/invoice-scan.entity';
import { S3Service } from '../../../s3/services/s3.service';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  ATTACHABLE_CONTENT_TYPES,
  AttachableEntityType,
  BillPreview,
  MAX_QBO_FILE_BYTES,
  NoteEntityType,
  QBO_ID,
  buildAttachableMultipart,
  buildBillPreview,
  mergeNote,
} from './qbo-write.utils';

export interface AttachResult {
  /** True when nothing was sent: either `confirm` was not given or the file is already there. */
  executed: boolean;
  alreadyAttached: boolean;
  fileName: string;
  bytes: number;
  entity: { type: string; id: string };
  attachableId?: string;
}

export interface NoteResult {
  executed: boolean;
  entity: { type: string; id: string };
  current: string;
  next: string;
  syncToken?: string;
}

export interface BillPreviewResult extends BillPreview {
  /** Bills in QuickBooks that already carry this document number for the same vendor. */
  possibleDuplicates: Array<{ id: string; docNumber: string | null; totalAmt: number | null }>;
}

/**
 * The basic QuickBooks writes. Each write previews first and only runs with
 * `confirm: true`. They only add a document or edit a memo: no amount, account,
 * vendor or date of an existing transaction is ever changed, and nothing is
 * deleted or voided. Every execution is logged.
 */
@Injectable()
export class QuickbooksWriteService {
  private readonly logger = new Logger(QuickbooksWriteService.name);

  constructor(
    private readonly api: QuickbooksApiService,
    private readonly s3: S3Service,
    @InjectRepository(InvoiceScan)
    private readonly scans: Repository<InvoiceScan>,
  ) {}

  async attachScanFile(
    realmId: string,
    input: { invoiceScanId: string; entityType: AttachableEntityType; entityId: string; confirm: boolean },
  ): Promise<AttachResult> {
    this.assertId(input.entityId);
    const scan = await this.scans.findOneBy({ id: input.invoiceScanId });
    if (!scan) throw new NotFoundException(`No existe el document scan ${input.invoiceScanId}.`);
    if (!scan.fileKey) throw new BadRequestException('Ese scan no tiene documento original guardado.');
    if (!ATTACHABLE_CONTENT_TYPES.has(scan.contentType)) {
      throw new BadRequestException(`Tipo de archivo no admitido por QuickBooks aquí: ${scan.contentType}.`);
    }

    await this.assertEntityExists(realmId, input.entityType, input.entityId);
    const entity = { type: input.entityType, id: input.entityId };

    if (await this.alreadyAttached(realmId, entity, scan.fileName)) {
      return { executed: false, alreadyAttached: true, fileName: scan.fileName, bytes: 0, entity };
    }

    const stored = await this.s3.getObjectBuffer(scan.fileKey);
    if (stored.buffer.length === 0 || stored.buffer.length > MAX_QBO_FILE_BYTES) {
      throw new BadRequestException('El documento está vacío o supera 5 MB.');
    }
    const preview: AttachResult = {
      executed: false,
      alreadyAttached: false,
      fileName: scan.fileName,
      bytes: stored.buffer.length,
      entity,
    };
    if (!input.confirm) return preview;

    const boundary = `----maros${randomUUID()}`;
    const response = await this.api.postRaw(
      realmId,
      '/upload',
      buildAttachableMultipart({
        boundary,
        fileName: scan.fileName,
        contentType: scan.contentType,
        content: stored.buffer,
        refs: [entity],
      }),
      { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    );
    this.logger.log(`QBO attach: scan ${scan.id} -> ${entity.type} ${entity.id} (${scan.fileName})`);
    return { ...preview, executed: true, attachableId: this.firstAttachableId(response) };
  }

  async updatePrivateNote(
    realmId: string,
    input: { entityType: NoteEntityType; entityId: string; note: string; mode: 'append' | 'replace'; confirm: boolean },
  ): Promise<NoteResult> {
    this.assertId(input.entityId);
    const response = await this.api.getById(realmId, input.entityType, input.entityId).catch(() => null);
    const entity = this.api.unwrapQboEntity(response, input.entityType);
    if (!entity.Id) throw new BadRequestException(`No existe ${input.entityType} ${input.entityId} en QuickBooks.`);

    const current = typeof entity.PrivateNote === 'string' ? entity.PrivateNote : '';
    const next = mergeNote(current, input.note, input.mode);
    const result: NoteResult = {
      executed: false,
      entity: { type: input.entityType, id: input.entityId },
      current,
      next,
    };
    if (!input.confirm || next === current) return result;

    const updated = await this.api.mutateEntity(realmId, input.entityType, {
      Id: input.entityId,
      SyncToken: String(entity.SyncToken ?? '0'),
      sparse: true,
      PrivateNote: next,
    });
    this.logger.log(`QBO note: ${input.entityType} ${input.entityId} (${input.mode})`);
    const syncToken = this.api.unwrapQboEntity(updated, input.entityType).SyncToken;
    return { ...result, executed: true, syncToken: typeof syncToken === 'string' ? syncToken : undefined };
  }

  /** Builds the Bill a scan would become, checks for duplicates, and creates NOTHING. */
  async previewBill(realmId: string, input: { invoiceScanId: string; accountId?: string }): Promise<BillPreviewResult> {
    const scan = await this.scans.findOneBy({ id: input.invoiceScanId });
    if (!scan) throw new NotFoundException(`No existe el document scan ${input.invoiceScanId}.`);
    const preview = buildBillPreview(scan, { accountId: input.accountId });

    const data = scan.extractedData;
    let possibleDuplicates: BillPreviewResult['possibleDuplicates'] = [];
    if (data?.invoiceNumber && data.counterpartyId && QBO_ID.test(data.counterpartyId)) {
      const doc = this.api.escapeQboString(data.invoiceNumber);
      const found = await this.api
        .query(realmId, `select Id, DocNumber, TotalAmt from Bill where DocNumber = '${doc}' and VendorRef = '${data.counterpartyId}'`)
        .catch(() => null);
      possibleDuplicates = this.api.getQueryResponseArray(found, 'Bill').map((row) => {
        const bill = row as Record<string, unknown>;
        return {
          id: String(bill.Id ?? ''),
          docNumber: typeof bill.DocNumber === 'string' ? bill.DocNumber : null,
          totalAmt: typeof bill.TotalAmt === 'number' ? bill.TotalAmt : null,
        };
      });
    }
    if (possibleDuplicates.length > 0 && preview.ready) {
      return {
        ready: false,
        blockers: [`A bill with this number already exists for this vendor (${possibleDuplicates.map((b) => b.id).join(', ')}).`],
        payload: preview.payload,
        possibleDuplicates,
      };
    }
    return { ...preview, possibleDuplicates };
  }

  private assertId(id: string): void {
    if (!QBO_ID.test(id)) throw new BadRequestException('El id de QuickBooks debe ser numérico.');
  }

  private async assertEntityExists(realmId: string, type: string, id: string): Promise<void> {
    const response = await this.api.getById(realmId, type, id).catch(() => null);
    if (!this.api.unwrapQboEntity(response, type).Id) {
      throw new BadRequestException(`No existe ${type} ${id} en QuickBooks.`);
    }
  }

  private async alreadyAttached(realmId: string, entity: { type: string; id: string }, fileName: string): Promise<boolean> {
    const found = await this.api
      .query(
        realmId,
        `select Id, FileName from Attachable where AttachableRef.EntityRef.Type = '${entity.type}' and AttachableRef.EntityRef.Value = '${entity.id}'`,
      )
      .catch(() => null);
    return this.api
      .getQueryResponseArray(found, 'Attachable')
      .some((row) => (row as Record<string, unknown>).FileName === fileName);
  }

  private firstAttachableId(response: unknown): string | undefined {
    const list = (response as { AttachableResponse?: Array<{ Attachable?: { Id?: string } }> } | null)?.AttachableResponse;
    return list?.[0]?.Attachable?.Id;
  }
}
