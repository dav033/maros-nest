import { BadRequestException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { Repository } from 'typeorm';
import { CompanyType } from '../../../../common/enums/company-type.enum';
import { Company } from '../../../../entities/company.entity';
import { QboReauthorizationRequiredException } from '../../exceptions/qbo-reauthorization-required.exception';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { InvoiceCounterpartyWriteService } from './invoice-counterparty-write.service';

interface Harness {
  service: InvoiceCounterpartyWriteService;
  qboApi: {
    queryAll: jest.Mock;
    mutateEntity: jest.Mock;
    unwrapQboEntity: jest.Mock;
  };
  companies: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  cache: { del: jest.Mock };
  saved: Company[];
}

function harness(
  opts: {
    vendors?: Array<{ Id: string; DisplayName: string }>;
    customers?: Array<{ Id: string; DisplayName: string }>;
    crmCompanies?: Array<Partial<Company>>;
    connected?: boolean;
    mutateError?: Error;
  } = {},
): Harness {
  const saved: Company[] = [];
  const crmCompanies = (opts.crmCompanies ?? []) as Company[];
  const qboApi = {
    queryAll: jest.fn((_realmId: string, entity: string) =>
      Promise.resolve(
        entity === 'Vendor' ? (opts.vendors ?? []) : (opts.customers ?? []),
      ),
    ),
    mutateEntity: jest.fn(
      (_realmId: string, entity: string, body: Record<string, unknown>) => {
        if (opts.mutateError) return Promise.reject(opts.mutateError);
        return Promise.resolve({
          [entity]: { Id: 'new-99', DisplayName: body.DisplayName },
        });
      },
    ),
    unwrapQboEntity: jest.fn(
      (response: Record<string, unknown>, entity: string) =>
        (response?.[entity] ?? {}) as Record<string, unknown>,
    ),
  };
  const financials = {
    getDefaultRealmId: jest.fn(() =>
      opts.connected === false
        ? Promise.reject(new QboReauthorizationRequiredException('(none)'))
        : Promise.resolve('realm-1'),
    ),
  };
  const companies = {
    find: jest.fn(() =>
      Promise.resolve(crmCompanies.map(({ id, name }) => ({ id, name }))),
    ),
    findOne: jest.fn(({ where }: { where: { id: number } }) =>
      Promise.resolve(crmCompanies.find((company) => company.id === where.id) ?? null),
    ),
    create: jest.fn((value: Partial<Company>) => ({ ...value }) as Company),
    save: jest.fn((value: Company) => {
      const stored = { ...value, id: value.id ?? 501 } as Company;
      saved.push(stored);
      return Promise.resolve(stored);
    }),
  };
  const cache = { del: jest.fn().mockResolvedValue(undefined) };
  const service = new InvoiceCounterpartyWriteService(
    qboApi as unknown as QuickbooksApiService,
    financials as unknown as QuickbooksFinancialsService,
    companies as unknown as Repository<Company>,
    cache as unknown as Cache,
  );
  return { service, qboApi, companies, cache, saved };
}

describe('InvoiceCounterpartyWriteService', () => {
  it('creates a vendor for money going out and links a new CRM company to it', async () => {
    const h = harness();

    const result = await h.service.create({
      name: 'Gulf Coast Lumber',
      direction: 'outgoing',
    });

    expect(h.qboApi.mutateEntity).toHaveBeenCalledWith('realm-1', 'Vendor', {
      DisplayName: 'Gulf Coast Lumber',
    });
    expect(result).toMatchObject({
      id: 'new-99',
      name: 'Gulf Coast Lumber',
      type: 'Vendor',
      existedInQuickbooks: false,
      existedInCrm: false,
      linkedToQuickbooks: true,
      crmCompanyId: 501,
    });
    expect(h.saved[0]).toMatchObject({
      name: 'Gulf Coast Lumber',
      qboVendorId: 'new-99',
      qboVendorName: 'Gulf Coast Lumber',
      qboVendorMatchConfidence: 1,
      type: CompanyType.SUPPLIER,
    });
    expect(h.saved[0].qboVendorMatchedAt).toBeInstanceOf(Date);
  });

  it('creates a customer for money coming in and links it by its own id', async () => {
    const h = harness();

    const result = await h.service.create({
      name: 'Anderson Family',
      direction: 'incoming',
    });

    expect(h.qboApi.mutateEntity).toHaveBeenCalledWith('realm-1', 'Customer', {
      DisplayName: 'Anderson Family',
    });
    expect(result).toMatchObject({ type: 'Customer', linkedToQuickbooks: true });
    expect(h.saved[0]).toMatchObject({
      name: 'Anderson Family',
      customer: true,
      qboCustomerName: 'Anderson Family',
    });
    expect(h.saved[0].qboCustomerId).toBeTruthy();
    expect(h.saved[0].qboCustomerMatchedAt).toBeInstanceOf(Date);
  });

  /**
   * The two ids are different records in QuickBooks and the same company can be both, so a
   * customer id must never reach the vendor columns — it would surface in the vendor map
   * (get_qbo_vendor_crm_map) as a supplier that does not exist.
   */
  it('keeps the customer id out of the vendor columns', async () => {
    const h = harness();

    await h.service.create({ name: 'Anderson Family', direction: 'incoming' });

    expect(h.saved[0].qboVendorId).toBeUndefined();
    expect(h.saved[0].qboVendorName).toBeUndefined();
    expect(h.saved[0].qboVendorMatchConfidence).toBeUndefined();
  });

  /** Same rule as the vendor side: a link somebody already made is not overwritten. */
  it('does not rewrite a company already pointing at another customer', async () => {
    const h = harness({
      crmCompanies: [
        {
          id: 9,
          name: 'Anderson Family',
          qboCustomerId: '777',
          qboCustomerName: 'Anderson Family (old)',
        },
      ],
    });

    const result = await h.service.create({
      name: 'Anderson Family',
      direction: 'incoming',
    });

    expect(result).toMatchObject({ existedInCrm: true, linkedToQuickbooks: false });
    expect(h.saved[0].qboCustomerId).toBe('777');
  });

  it('takes an explicit type over the direction', async () => {
    const h = harness();

    const result = await h.service.create({
      name: 'Coastal Roofing',
      direction: 'outgoing',
      type: 'Customer',
    });

    expect(result.type).toBe('Customer');
    expect(h.qboApi.mutateEntity).toHaveBeenCalledWith(
      'realm-1',
      'Customer',
      expect.anything(),
    );
  });

  it('asks for a direction when there is none to deduce from', async () => {
    const h = harness();

    await expect(
      h.service.create({ name: 'Somebody', direction: 'unknown' }),
    ).rejects.toThrow(/direction of the transaction/i);
    expect(h.qboApi.mutateEntity).not.toHaveBeenCalled();
  });

  // Un padrón con "Home Depot" y "HOME DEPOT " duplicados es justo lo que esta
  // pantalla tiene que evitar: QuickBooks no borra, solo desactiva.
  it('returns the vendor QuickBooks already has under that name instead of duplicating it', async () => {
    const h = harness({ vendors: [{ Id: '58', DisplayName: 'Home Depot' }] });

    const result = await h.service.create({
      name: '  home   depot ',
      direction: 'outgoing',
    });

    expect(h.qboApi.mutateEntity).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: '58',
      name: 'Home Depot',
      type: 'Vendor',
      existedInQuickbooks: true,
    });
    // Sin filtro de Active: un vendor desactivado conserva su nombre y
    // QuickBooks rechazaría el duplicado.
    expect(h.qboApi.queryAll).toHaveBeenCalledWith(
      'realm-1',
      'Vendor',
      expect.not.objectContaining({ where: expect.anything() }),
    );
  });

  it('refuses when the name is taken on the other side of QuickBooks', async () => {
    const h = harness({ customers: [{ Id: '7', DisplayName: 'Anderson Family' }] });

    await expect(
      h.service.create({ name: 'anderson family', direction: 'outgoing' }),
    ).rejects.toThrow(/already has a customer named “Anderson Family”/);
    expect(h.qboApi.mutateEntity).not.toHaveBeenCalled();
  });

  it('links the CRM company that already carries the name instead of duplicating it', async () => {
    const h = harness({
      crmCompanies: [{ id: 12, name: 'Gulf Coast Lumber', type: CompanyType.SUBCONTRACTOR }],
    });

    const result = await h.service.create({
      name: 'GULF COAST LUMBER',
      direction: 'outgoing',
    });

    expect(h.companies.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      crmCompanyId: 12,
      existedInCrm: true,
      linkedToQuickbooks: true,
    });
    // El tipo que ya tenía manda: una subcontrata no se convierte en proveedor
    // por crear su vendor.
    expect(h.saved[0]).toMatchObject({
      id: 12,
      qboVendorId: 'new-99',
      type: CompanyType.SUBCONTRACTOR,
    });
  });

  it('keeps a QuickBooks link the CRM company already had', async () => {
    const h = harness({
      crmCompanies: [{ id: 12, name: 'Gulf Coast Lumber', qboVendorId: 'other-1' }],
    });

    const result = await h.service.create({
      name: 'Gulf Coast Lumber',
      direction: 'outgoing',
    });

    expect(result).toMatchObject({
      crmCompanyId: 12,
      existedInCrm: true,
      linkedToQuickbooks: false,
    });
    expect(h.companies.save).not.toHaveBeenCalled();
  });

  it('reports what QuickBooks said when it rejects the name', async () => {
    const h = harness({
      mutateError: Object.assign(new Error('Request failed with status code 400'), {
        response: {
          data: {
            Fault: {
              Error: [
                {
                  Message: 'Duplicate Name Exists Error',
                  Detail: 'The name supplied already exists.',
                },
              ],
            },
          },
        },
      }),
    });

    await expect(
      h.service.create({ name: 'Home Depot', direction: 'outgoing' }),
    ).rejects.toThrow(
      /did not accept “Home Depot”: Duplicate Name Exists Error — The name supplied already exists\./,
    );
    expect(h.companies.save).not.toHaveBeenCalled();
    expect(h.cache.del).not.toHaveBeenCalled();
  });

  it('fails before touching the CRM when QuickBooks is not connected', async () => {
    const h = harness({ connected: false });

    await expect(
      h.service.create({ name: 'Gulf Coast Lumber', direction: 'outgoing' }),
    ).rejects.toBeInstanceOf(QboReauthorizationRequiredException);
    expect(h.qboApi.mutateEntity).not.toHaveBeenCalled();
    expect(h.companies.save).not.toHaveBeenCalled();
  });

  it('drops the cached counterparty list so the new name shows up in the next search', async () => {
    const h = harness();

    await h.service.create({ name: 'Gulf Coast Lumber', direction: 'outgoing' });

    expect(h.cache.del).toHaveBeenCalledWith('invoice-scans:qbo-counterparties');
  });

  it('rejects a blank name', async () => {
    const h = harness();

    await expect(
      h.service.create({ name: '   ', direction: 'outgoing' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
