import { QuickbooksReportsContextService } from './quickbooks-reports.context.service';

const BASE_JOB = {
  Id: '387',
  DisplayName: '001R-0625, 3324 NW 14th St Fl 33, Miami, FL 33125, USA Roofing Leaking',
};
const CHANGE_ORDER_JOB = {
  Id: '283',
  DisplayName: '001R-0625 C01, 3324 NW 14th St Fl 33, Miami, FL 33125, USA Roofing Leaking',
};

describe('QuickbooksReportsContextService.buildJobIndex', () => {
  let service: QuickbooksReportsContextService;
  let projectRows: Array<{ leadNumber: string; qboCustomerId: string | null }>;
  let customers: Array<{ Id: string; DisplayName: string }>;
  let apiService: { queryAll: jest.Mock };
  let cacheEntries: Map<string, unknown>;

  beforeEach(() => {
    projectRows = [];
    customers = [];
    cacheEntries = new Map();

    const queryBuilder: Record<string, jest.Mock> = {
      innerJoin: jest.fn(() => queryBuilder),
      select: jest.fn(() => queryBuilder),
      addSelect: jest.fn(() => queryBuilder),
      where: jest.fn(() => queryBuilder),
      andWhere: jest.fn(() => queryBuilder),
      getRawMany: jest.fn(() => Promise.resolve(projectRows)),
    };
    const leadRepo = { createQueryBuilder: jest.fn(() => queryBuilder) };
    apiService = { queryAll: jest.fn(() => Promise.resolve(customers)) };
    const cacheManager = {
      get: jest.fn((key: string) => Promise.resolve(cacheEntries.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        cacheEntries.set(key, value);
        return Promise.resolve();
      }),
    };

    service = new QuickbooksReportsContextService(
      {} as never,
      leadRepo as never,
      apiService as never,
      cacheManager as never,
    );
  });

  it('lets the stored qboCustomerId decide which job carries the project number', async () => {
    // Both names contain 001R-0625, so name matching alone can pick either one.
    customers = [BASE_JOB, CHANGE_ORDER_JOB];
    projectRows = [{ leadNumber: '001R-0625', qboCustomerId: '283' }];

    const index = await service.buildJobIndex('realm-1');

    expect(index.projectNumberById['283']).toBe('001R-0625');
    expect(index.projectNumberById['387']).toBeNull();
  });

  it('still falls back to name matching for projects that were never imported', async () => {
    customers = [BASE_JOB];
    projectRows = [{ leadNumber: '001R-0625', qboCustomerId: null }];

    const index = await service.buildJobIndex('realm-1');

    expect(index.projectNumberById['387']).toBe('001R-0625');
  });

  it('falls back to name matching when the stored job is no longer in QuickBooks', async () => {
    // El job vinculado se borro o se desactivo en QBO: quedarse sin numero seria
    // perder el dato que el match por nombre todavia puede dar.
    customers = [BASE_JOB];
    projectRows = [{ leadNumber: '001R-0625', qboCustomerId: '999' }];

    const index = await service.buildJobIndex('realm-1');

    expect(index.projectNumberById['387']).toBe('001R-0625');
  });

  it('reuses the cached index until a link changes, and rebuilds it right after', async () => {
    customers = [BASE_JOB, CHANGE_ORDER_JOB];
    projectRows = [{ leadNumber: '001R-0625', qboCustomerId: '283' }];

    await service.buildJobIndex('realm-1');
    await service.buildJobIndex('realm-1');
    expect(apiService.queryAll).toHaveBeenCalledTimes(1);

    // Un unlink cambia la huella de vinculos: el informe siguiente lo ve en vez
    // de esperar a que caduquen los 5 minutos de TTL.
    projectRows = [{ leadNumber: '001R-0625', qboCustomerId: null }];
    const index = await service.buildJobIndex('realm-1');

    expect(apiService.queryAll).toHaveBeenCalledTimes(2);
    expect(index.projectNumberById['387']).toBe('001R-0625');
    expect(index.projectNumberById['283']).toBeNull();
  });
});
