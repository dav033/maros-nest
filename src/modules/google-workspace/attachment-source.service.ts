import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvoiceScan } from '../quickbooks/entities/invoice-scan.entity';
import { S3Service } from '../s3/services/s3.service';
import { DraftAttachment } from './gmail-drafts.service';
import {
  ALLOWED_CONTENT_TYPES,
  decodeBase64,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  safeName,
} from './workspace-input';

export type AttachmentSpec =
  | { kind: 'invoice_scan'; id: string }
  | { kind: 'inline'; fileName: string; contentType: string; contentBase64: string };

export interface StoredInvoiceFile {
  scan: InvoiceScan;
  content: Buffer;
  contentType: string;
}

/**
 * Turns "what to attach" into bytes. Only two sources exist: the original
 * document of an invoice scan, or small inline content. Arbitrary S3 keys and
 * URLs are deliberately not accepted, so a caller cannot read files outside
 * the invoice index.
 */
@Injectable()
export class AttachmentSourceService {
  constructor(
    @InjectRepository(InvoiceScan)
    private readonly scans: Repository<InvoiceScan>,
    private readonly s3: S3Service,
  ) {}

  async resolveAll(specs: AttachmentSpec[]): Promise<DraftAttachment[]> {
    if (specs.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(`Máximo ${MAX_ATTACHMENTS} adjuntos por borrador.`);
    }
    const files: DraftAttachment[] = [];
    let total = 0;
    for (const spec of specs) {
      const file = await this.resolve(spec);
      total += file.content.length;
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new BadRequestException(
          `Los adjuntos suman más de ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB, el límite de Gmail.`,
        );
      }
      files.push(file);
    }
    return files;
  }

  async loadInvoiceFile(id: string): Promise<StoredInvoiceFile> {
    const scan = await this.scans.findOneBy({ id });
    if (!scan) throw new NotFoundException(`No existe el document scan ${id}.`);
    if (!scan.fileKey) {
      throw new BadRequestException(`El document scan ${id} no tiene documento original guardado.`);
    }
    const stored = await this.s3.getObjectBuffer(scan.fileKey);
    if (stored.buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('El documento supera el máximo de 5 MB.');
    }
    return {
      scan,
      content: stored.buffer,
      contentType: scan.contentType || stored.contentType || 'application/octet-stream',
    };
  }

  private async resolve(spec: AttachmentSpec): Promise<DraftAttachment> {
    if (spec.kind === 'invoice_scan') {
      const file = await this.loadInvoiceFile(spec.id);
      return {
        fileName: safeName(file.scan.fileName, 'invoice'),
        contentType: file.contentType,
        content: file.content,
      };
    }
    if (!ALLOWED_CONTENT_TYPES.has(spec.contentType)) {
      throw new BadRequestException(`Tipo de archivo no permitido: ${spec.contentType}.`);
    }
    return {
      fileName: safeName(spec.fileName, 'attachment'),
      contentType: spec.contentType,
      content: this.decode(spec.contentBase64),
    };
  }

  private decode(contentBase64: string): Buffer {
    try {
      return decodeBase64(contentBase64, MAX_ATTACHMENT_BYTES);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Adjunto inválido.');
    }
  }
}
