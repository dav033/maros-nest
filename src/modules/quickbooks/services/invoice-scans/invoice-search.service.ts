import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InvoiceScan } from '../../entities/invoice-scan.entity';
import { InvoiceScanNotificationsService } from './invoice-scan-notifications.service';
import { InvoiceLocationService } from './invoice-location.service';
import {
  attachLocations,
  buildSearchReport,
  InvoiceSearchInput,
  InvoiceSearchReport,
} from './invoice-search';

const SEARCH_SCAN_LIMIT = 500;
const SEARCH_UNASSIGNED_LIMIT = 300;

/**
 * Looks requested projects up in the invoice index (`invoice_scans`) instead of
 * walking Drive. Project numbers come in short (`064P`) or full (`064P-0826`)
 * form; vendor matching and the missing-document report live in
 * `buildSearchReport`. Read-only.
 */
@Injectable()
export class InvoiceSearchService {
  constructor(
    @InjectRepository(InvoiceScan)
    private readonly scans: Repository<InvoiceScan>,
    private readonly notifications: InvoiceScanNotificationsService,
    private readonly locations: InvoiceLocationService,
  ) {}

  async search(input: InvoiceSearchInput): Promise<InvoiceSearchReport> {
    const params: Record<string, string> = {};
    const clauses = input.projects.map((project, index) => {
      const value = project.trim().toUpperCase();
      params[`exact${index}`] = value;
      if (value.includes('-')) return `UPPER(scan.projectNumber) = :exact${index}`;
      params[`prefix${index}`] = `${value}-%`;
      return `(UPPER(scan.projectNumber) = :exact${index} OR UPPER(scan.projectNumber) LIKE :prefix${index})`;
    });

    const projectScans = await this.scans
      .createQueryBuilder('scan')
      .where(clauses.join(' OR '), params)
      .orderBy('scan.createdAt', 'DESC')
      .take(SEARCH_SCAN_LIMIT)
      .getMany();

    const unassignedScans =
      input.vendors.length > 0
        ? await this.scans.find({
            where: { projectNumber: IsNull() },
            order: { createdAt: 'DESC' },
            take: SEARCH_UNASSIGNED_LIMIT,
          })
        : [];

    const report = buildSearchReport(input, projectScans, unassignedScans, (id) =>
      this.notifications.scanUrl(id),
    );
    const ids = [...new Set([...projectScans, ...unassignedScans].map((scan) => scan.id))];
    return attachLocations(report, await this.locations.forScans(ids));
  }
}
