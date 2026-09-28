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

  beforeEach(() => {
    projectRows = [];
    customers = [];

    const queryBuilder: Record<string, jest.Mock> = {
      innerJoin: jest.fn(() => queryBuilder),
      select: jest.fn(() => queryBuilder),
      addSelect: jest.fn(() => queryBuilder),
      where: jest.fn(() => queryBuilder),
      andWhere: jest.fn(() => queryBuilder),
      getRawMany: jest.fn(() => Promise.resolve(projectRows)),
    };
    const leadRepo = { createQueryBuilder: jest.fn(() => queryBuilder) };
    const apiService = { queryAll: jest.fn(() => Promise.resolve(customers)) };
    const cacheManager = {
      get: jest.fn(() => Promise.resolve(undefined)),
      set: jest.fn(() => Promise.resolve()),
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
});
