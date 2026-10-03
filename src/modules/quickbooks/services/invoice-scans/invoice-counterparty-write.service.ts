import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyType } from '../../../../common/enums/company-type.enum';
import { Company } from '../../../../entities/company.entity';
import { CreateQboCounterpartyDto } from '../../dto/create-qbo-counterparty.dto';
import type { QboCounterpartyType } from '../../entities/invoice-scan.entity';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { COUNTERPARTIES_CACHE_KEY } from '../invoice-scans.service';

export interface CreatedCounterparty {
  id: string;
  name: string;
  type: QboCounterpartyType;
  /** The QuickBooks record was already there under this name; nothing was created. */
  existedInQuickbooks: boolean;
  crmCompanyId: number;
  /** The CRM company was already there under this name; it was not duplicated. */
  existedInCrm: boolean;
  /**
   * Whether the CRM company ended up pointing at this QuickBooks record. False
   * for a customer (there is no column for it) and for a company that already
   * carried a link to a different vendor.
   */
  linkedToQuickbooks: boolean;
}

type QboRecord = Record<string, unknown>;

/**
 * Enough pages for a padrón of up to five thousand names on each side. The read
 * exists to avoid a duplicate, so it is better to pay for it than to guess.
 */
const MAX_LOOKUP_PAGES = 5;

/**
 * A link this service writes is not a guess: it created the QuickBooks record
 * itself. 1 also sits above the matcher's CONFIRMED_CONFIDENCE, so a later
 * fuzzy suggestion cannot quietly displace it.
 */
const CREATED_LINK_CONFIDENCE = 1;

/**
 * Case- and whitespace-insensitive form of a name, for the duplicate check.
 *
 * Deliberately *not* `normalizeCompanyName`: that one also drops legal suffixes
 * because it ranks fuzzy suggestions, and here a false positive hands back "ABC
 * Inc" to somebody who asked for "ABC LLC" — two different companies. This
 * screen creates records that QuickBooks will never delete, so the question it
 * has to answer is "is this the same name?", not "does this look similar?".
 */
function normalizeForDuplicateCheck(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Creates the counterparty of a scanned document in QuickBooks and in the CRM.
 *
 * Lives outside InvoiceScansService because it writes to QuickBooks and to
 * `companies`, while that service reads the picker's list; the two only share
 * the cache key the list is stored under.
 */
@Injectable()
export class InvoiceCounterpartyWriteService {
  private readonly logger = new Logger(InvoiceCounterpartyWriteService.name);

  constructor(
    private readonly qboApi: QuickbooksApiService,
    private readonly financials: QuickbooksFinancialsService,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @Inject(CACHE_MANAGER) private readonly cache?: Cache,
  ) {}

  async create(input: CreateQboCounterpartyDto): Promise<CreatedCounterparty> {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('Type the name of the vendor or customer first.');
    }
    const type = this.resolveType(input);

    // Throws QboReauthorizationRequiredException when nothing is connected, so
    // a disconnected QuickBooks never gets as far as writing to the CRM: a CRM
    // company with no QuickBooks record to point at is the half-made pair this
    // whole screen exists to avoid.
    const realmId = await this.financials.getDefaultRealmId();

    const found = await this.findExistingByName(realmId, name);
    if (found && found.type !== type) {
      // QuickBooks keeps one namespace for customers, vendors and employees, so
      // this create would be rejected anyway. The record is already in the
      // picker under the other type, which is the way out.
      throw new BadRequestException(
        `QuickBooks already has a ${found.type.toLowerCase()} named “${found.name}”. ` +
          'QuickBooks does not allow a second record with the same name, so pick that ' +
          'one from the list or use a different name.',
      );
    }

    const counterparty = found ?? (await this.createInQbo(realmId, type, name));
    const crm = await this.linkOrCreateCompany(counterparty, type);
    await this.cache?.del(COUNTERPARTIES_CACHE_KEY);

    this.logger.log(
      `Counterparty ${counterparty.name} (${type} ${counterparty.id}, ` +
        `${found ? 'already in QuickBooks' : 'created in QuickBooks'}) → ` +
        `CRM company ${crm.id} (${crm.existed ? 'existing' : 'created'}, ` +
        `${crm.linked ? 'linked' : 'not linked'})`,
    );

    return {
      id: counterparty.id,
      name: counterparty.name,
      type,
      existedInQuickbooks: found !== null,
      crmCompanyId: crm.id,
      existedInCrm: crm.existed,
      linkedToQuickbooks: crm.linked,
    };
  }

  /** Money going out is paid to a vendor; money coming in arrives from a customer. */
  private resolveType(input: CreateQboCounterpartyDto): QboCounterpartyType {
    if (input.type) return input.type;
    if (input.direction === 'outgoing') return 'Vendor';
    if (input.direction === 'incoming') return 'Customer';
    throw new BadRequestException(
      'Set the direction of the transaction (money out or money in) before creating the counterparty.',
    );
  }

  /**
   * The QuickBooks record that already carries this name, on either side.
   *
   * Inactive records count: QuickBooks does not delete a vendor or a customer,
   * it deactivates it, and a deactivated name stays taken.
   */
  private async findExistingByName(
    realmId: string,
    name: string,
  ): Promise<{ id: string; name: string; type: QboCounterpartyType } | null> {
    const select = 'Id, DisplayName, CompanyName';
    const [vendors, customers] = await Promise.all([
      this.qboApi.queryAll(realmId, 'Vendor', {
        select,
        maxPages: MAX_LOOKUP_PAGES,
      }),
      this.qboApi.queryAll(realmId, 'Customer', {
        select,
        maxPages: MAX_LOOKUP_PAGES,
      }),
    ]);
    const needle = normalizeForDuplicateCheck(name);
    return (
      this.matchByName(vendors, 'Vendor', needle) ??
      this.matchByName(customers, 'Customer', needle)
    );
  }

  private matchByName(
    records: unknown[],
    type: QboCounterpartyType,
    needle: string,
  ): { id: string; name: string; type: QboCounterpartyType } | null {
    for (const value of records) {
      if (value === null || typeof value !== 'object') continue;
      const record = value as QboRecord;
      const displayName = String(record.DisplayName ?? record.CompanyName ?? '');
      const id = String(record.Id ?? '');
      if (!id || normalizeForDuplicateCheck(displayName) !== needle) continue;
      return { id, name: displayName.trim(), type };
    }
    return null;
  }

  private async createInQbo(
    realmId: string,
    type: QboCounterpartyType,
    name: string,
  ): Promise<{ id: string; name: string }> {
    let raw: QboRecord;
    try {
      const response = await this.qboApi.mutateEntity(realmId, type, {
        DisplayName: name,
      });
      raw = this.qboApi.unwrapQboEntity(response, type);
    } catch (error) {
      throw new BadRequestException(
        `QuickBooks did not accept “${name}”: ${extractQboFaultMessage(error)}`,
      );
    }
    const id = String(raw.Id ?? '');
    if (!id) {
      throw new BadRequestException(
        `QuickBooks did not return the new ${type.toLowerCase()} for “${name}”. Check in QuickBooks before trying again.`,
      );
    }
    return { id, name: String(raw.DisplayName ?? name).trim() };
  }

  /**
   * The CRM half of the pair.
   *
   * A vendor gets `qboVendorId` and the SUPPLIER type, which is what makes the
   * company visible to the existing CRM↔QuickBooks vendor matching. A customer
   * gets `customer: true` and no QuickBooks id: the only link columns on
   * `companies` are the `qbo_vendor_*` ones, and a customer id stored there
   * would show up in the vendor map as a vendor that does not exist.
   */
  private async linkOrCreateCompany(
    counterparty: { id: string; name: string },
    type: QboCounterpartyType,
  ): Promise<{ id: number; existed: boolean; linked: boolean }> {
    const existing = await this.findCompanyByName(counterparty.name);
    const company = existing ?? this.companies.create({ name: counterparty.name });
    const existed = existing !== null;

    if (type === 'Customer') {
      company.customer = true;
      // `client` is left alone: nothing in the codebase says what separates it
      // from `customer`, and guessing would put this company in a list it may
      // not belong to.
      const saved = await this.companies.save(company);
      return { id: saved.id, existed, linked: false };
    }

    const keepsOtherLink =
      !!company.qboVendorId && company.qboVendorId !== counterparty.id;
    if (keepsOtherLink) {
      this.logger.warn(
        `CRM company ${company.id} (${company.name}) already points at QuickBooks vendor ` +
          `${company.qboVendorId}; the link to the new vendor ${counterparty.id} was not written.`,
      );
      return { id: company.id, existed: true, linked: false };
    }

    company.qboVendorId = counterparty.id;
    company.qboVendorName = counterparty.name;
    company.qboVendorMatchConfidence = CREATED_LINK_CONFIDENCE;
    company.qboVendorMatchedAt = new Date();
    company.type ??= CompanyType.SUPPLIER;
    const saved = await this.companies.save(company);
    return { id: saved.id, existed, linked: true };
  }

  /**
   * Normalizing in SQL is not possible here, so the names are compared in
   * memory: two columns of a table this CRM counts in hundreds of rows, read
   * once per deliberate creation. The row found is then loaded whole, because
   * what comes back is about to be saved.
   */
  private async findCompanyByName(name: string): Promise<Company | null> {
    const needle = normalizeForDuplicateCheck(name);
    const rows = await this.companies.find({ select: ['id', 'name'] });
    const match = rows.find(
      (company) => normalizeForDuplicateCheck(company.name) === needle,
    );
    if (!match) return null;
    return this.companies.findOne({ where: { id: match.id } });
  }
}

/** The message Intuit put in the Fault of a rejected write, if there is one. */
function extractQboFaultMessage(error: unknown): string {
  const response = (error as { response?: { data?: unknown } })?.response;
  const fault = (
    response?.data as
      | { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } }
      | undefined
  )?.Fault;
  const messages = (fault?.Error ?? [])
    .map((entry) => [entry.Message, entry.Detail].filter(Boolean).join(' — '))
    .filter((message) => message.length > 0);
  if (messages.length > 0) return messages.join('; ');
  const message = (error as { message?: string })?.message;
  return message && message.length > 0 ? message : 'the write was rejected.';
}
