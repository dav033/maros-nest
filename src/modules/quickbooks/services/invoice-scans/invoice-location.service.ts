import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InvoiceDocumentEvent } from '../../entities/invoice-document-event.entity';
import {
  InvoiceDocumentLocation,
  InvoiceDocumentStatus,
} from '../../entities/invoice-document-location.entity';

export interface FiledDocument {
  invoiceScanId: string;
  driveFileId: string;
  driveUrl: string | null;
  driveName: string;
  driveFolder: string;
  actor: string;
}

export interface LocationView {
  id: string;
  invoiceScanId: string;
  driveFileId: string;
  driveUrl: string | null;
  driveName: string;
  driveFolder: string;
  status: InvoiceDocumentStatus;
  receivedAt: Date;
  updatedAt: Date;
}

export interface LocationEventView {
  fromStatus: InvoiceDocumentStatus | null;
  toStatus: InvoiceDocumentStatus;
  driveFolder: string | null;
  note: string | null;
  actor: string;
  createdAt: Date;
}

const MIGRATION_HINT =
  'The invoice index tables are missing: apply db/add-invoice-drive-locations.sql to the database first.';

/** Postgres "undefined_table": the migration has not been applied yet. */
export function isMissingTable(error: unknown): boolean {
  const code = (error as { driverError?: { code?: string }; code?: string } | null);
  return code?.driverError?.code === '42P01' || code?.code === '42P01';
}

/**
 * The invoice index: where each invoice document lives in Drive, its state and the
 * history of changes. Recording and reading are tolerant of the tables not existing
 * yet (filing and searching keep working); only explicit updates report it.
 */
@Injectable()
export class InvoiceLocationService {
  private readonly logger = new Logger(InvoiceLocationService.name);
  private warnedMissing = false;

  constructor(
    @InjectRepository(InvoiceDocumentLocation)
    private readonly locations: Repository<InvoiceDocumentLocation>,
    @InjectRepository(InvoiceDocumentEvent)
    private readonly events: Repository<InvoiceDocumentEvent>,
  ) {}

  /** Records a freshly filed document. Never throws: the index is optional. Returns whether it was recorded. */
  async recordFiled(input: FiledDocument): Promise<boolean> {
    try {
      const existing = await this.locations.findOneBy({ driveFileId: input.driveFileId });
      if (existing) return true;
      const location = await this.locations.save(
        this.locations.create({
          invoiceScanId: input.invoiceScanId,
          driveFileId: input.driveFileId,
          driveUrl: input.driveUrl,
          driveName: input.driveName,
          driveFolder: input.driveFolder,
          status: 'in_receipts',
        }),
      );
      await this.events.save(
        this.events.create({
          locationId: location.id,
          fromStatus: null,
          toStatus: 'in_receipts',
          driveFolder: input.driveFolder,
          note: 'Filed from the invoice scan',
          actor: input.actor,
        }),
      );
      return true;
    } catch (error) {
      this.report(error, 'record');
      return false;
    }
  }

  /** Changes the state (and optionally the folder) of a document, keeping the history. */
  async update(input: {
    invoiceScanId: string;
    status: InvoiceDocumentStatus;
    driveFileId?: string;
    driveFolder?: string;
    note?: string;
    actor: string;
  }): Promise<{ location: LocationView; changed: boolean }> {
    const found = await this.find(input.invoiceScanId, input.driveFileId);
    const folder = input.driveFolder ?? found.driveFolder;
    if (found.status === input.status && folder === found.driveFolder && !input.note) {
      return { location: this.view(found), changed: false };
    }
    const previous = found.status;
    found.status = input.status;
    found.driveFolder = folder;
    const saved = await this.locations.save(found);
    await this.events.save(
      this.events.create({
        locationId: saved.id,
        fromStatus: previous,
        toStatus: input.status,
        driveFolder: folder,
        note: input.note ?? null,
        actor: input.actor,
      }),
    );
    return { location: this.view(saved), changed: true };
  }

  async history(invoiceScanId: string): Promise<Array<LocationView & { events: LocationEventView[] }>> {
    const rows = await this.guard(() => this.locations.find({ where: { invoiceScanId }, order: { receivedAt: 'ASC' } }));
    const events = rows.length
      ? await this.guard(() =>
          this.events.find({ where: { locationId: In(rows.map((row) => row.id)) }, order: { createdAt: 'ASC' } }),
        )
      : [];
    return rows.map((row) => ({
      ...this.view(row),
      events: events
        .filter((event) => event.locationId === row.id)
        .map((event) => ({
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          driveFolder: event.driveFolder,
          note: event.note,
          actor: event.actor,
          createdAt: event.createdAt,
        })),
    }));
  }

  /** Locations of many scans for search results; empty when the tables are not there yet. */
  async forScans(invoiceScanIds: string[]): Promise<Map<string, LocationView[]>> {
    const byScan = new Map<string, LocationView[]>();
    if (invoiceScanIds.length === 0) return byScan;
    try {
      const rows = await this.locations.find({ where: { invoiceScanId: In(invoiceScanIds) }, order: { receivedAt: 'ASC' } });
      for (const row of rows) {
        const list = byScan.get(row.invoiceScanId) ?? [];
        list.push(this.view(row));
        byScan.set(row.invoiceScanId, list);
      }
    } catch (error) {
      this.report(error, 'read');
    }
    return byScan;
  }

  private async find(invoiceScanId: string, driveFileId?: string): Promise<InvoiceDocumentLocation> {
    const rows = await this.guard(() =>
      this.locations.find({
        where: driveFileId ? { invoiceScanId, driveFileId } : { invoiceScanId },
        order: { receivedAt: 'DESC' },
      }),
    );
    if (rows.length === 0) {
      throw new NotFoundException('No Drive location is recorded for that invoice scan (file it first with save_invoice_to_receipts).');
    }
    if (rows.length > 1 && !driveFileId) {
      throw new NotFoundException(
        `That invoice scan has ${rows.length} Drive locations: pass driveFileId (${rows.map((row) => row.driveFileId).join(', ')}).`,
      );
    }
    return rows[0];
  }

  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isMissingTable(error)) throw new ServiceUnavailableException(MIGRATION_HINT);
      throw error;
    }
  }

  private report(error: unknown, action: string): void {
    if (isMissingTable(error)) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        this.logger.warn(`Invoice index not available (${action}): ${MIGRATION_HINT}`);
      }
      return;
    }
    this.logger.error(`Invoice index ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  private view(row: InvoiceDocumentLocation): LocationView {
    return {
      id: row.id,
      invoiceScanId: row.invoiceScanId,
      driveFileId: row.driveFileId,
      driveUrl: row.driveUrl,
      driveName: row.driveName,
      driveFolder: row.driveFolder,
      status: row.status,
      receivedAt: row.receivedAt,
      updatedAt: row.updatedAt,
    };
  }
}
