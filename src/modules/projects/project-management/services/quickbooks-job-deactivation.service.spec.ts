import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { DeactivateQuickbooksJobDto } from '../dto/deactivate-quickbooks-job.dto';
import { QuickbooksJobDeactivationService } from './quickbooks-job-deactivation.service';

/** El job que auditamos: saldo abierto de 24.272,10. */
const JOB_WITH_BALANCE = {
  Id: '387',
  SyncToken: '3',
  DisplayName: '001R-0625, 3324 NW 14th St, Miami, FL',
  Active: true,
  Balance: 24272.1,
  Job: true,
};

const CLEAN_JOB = {
  Id: '501',
  SyncToken: '0',
  DisplayName: '002R-0725, 10 SW 1st Ave, Miami, FL',
  Active: true,
  Balance: 0,
  Job: true,
};

describe('QuickbooksJobDeactivationService', () => {
  let service: QuickbooksJobDeactivationService;
  let customers: Map<string, Record<string, unknown>>;
  let projects: Project[];
  let api: {
    getCustomer: jest.Mock;
    mutateEntity: jest.Mock;
    unwrapQboEntity: jest.Mock;
    clearReadCache: jest.Mock;
  };
  let financials: { invalidateJobIndex: jest.Mock };

  const confirmed = (qboCustomerId: string): DeactivateQuickbooksJobDto => ({
    qboCustomerId,
    confirm: true,
  });

  beforeEach(() => {
    customers = new Map<string, Record<string, unknown>>([
      ['387', { ...JOB_WITH_BALANCE }],
      ['501', { ...CLEAN_JOB }],
      ['999', { ...CLEAN_JOB, Id: '999', Active: false, DisplayName: 'Job ya inactivo' }],
    ]);
    projects = [];

    api = {
      getCustomer: jest.fn((_realmId: string, id: string) => {
        const customer = customers.get(id);
        if (!customer) return Promise.reject(new Error(`no such customer ${id}`));
        return Promise.resolve({ Customer: customer });
      }),
      mutateEntity: jest.fn((_realmId: string, _entity: string, body: Record<string, unknown>) =>
        Promise.resolve({
          Customer: {
            ...customers.get(String(body.Id)),
            Active: body.Active,
            SyncToken: String(Number(body.SyncToken) + 1),
          },
        }),
      ),
      // Mismo desenvoltorio que el servicio real: el envoltorio de QBO es
      // { Customer: {...} } tanto al leer como al escribir.
      unwrapQboEntity: jest.fn((response: unknown, name: string) => {
        const entity = (response as Record<string, unknown>)?.[name];
        return entity && typeof entity === 'object' ? entity : {};
      }),
      clearReadCache: jest.fn(),
    };
    financials = { invalidateJobIndex: jest.fn() };

    const connectionRepo = {
      find: jest.fn(() => Promise.resolve([{ realmId: 'realm-1' }])),
    };
    const projectRepo = {
      findOne: jest.fn(({ where }: { where: { qboCustomerId?: string } }) =>
        Promise.resolve(
          projects.find((project) => project.qboCustomerId === where.qboCustomerId) ?? null,
        ),
      ),
    };

    service = new QuickbooksJobDeactivationService(
      connectionRepo as never,
      projectRepo as never,
      api as never,
      financials as never,
    );
  });

  function linkProject(qboCustomerId: string): void {
    const lead = Object.assign(new Lead(), { id: 50, leadNumber: '002R-0725' });
    projects.push(Object.assign(new Project(), { id: 70, lead, qboCustomerId }));
  }

  it('rejects a job with an open balance and names the amount', async () => {
    await expect(service.deactivateJob(confirmed('387'))).rejects.toThrow(/24272\.10/);
    expect(api.mutateEntity).not.toHaveBeenCalled();
  });

  it('rejects a job a CRM project still points at and asks to unlink first', async () => {
    linkProject('501');

    await expect(service.deactivateJob(confirmed('501'))).rejects.toThrow(
      /linked to CRM project #70 \(002R-0725\)\. Unlink it first/,
    );
    expect(api.mutateEntity).not.toHaveBeenCalled();
  });

  it('rejects the call without confirm: true, before reading anything', async () => {
    await expect(
      service.deactivateJob({ qboCustomerId: '501' } as DeactivateQuickbooksJobDto),
    ).rejects.toThrow(/confirm: true/);
    await expect(
      service.deactivateJob({ qboCustomerId: '501', confirm: false }),
    ).rejects.toThrow(/confirm: true/);

    expect(api.getCustomer).not.toHaveBeenCalled();
    expect(api.mutateEntity).not.toHaveBeenCalled();
  });

  it('does not write again for a job QuickBooks already has inactive', async () => {
    const result = await service.deactivateJob(confirmed('999'));

    expect(result).toMatchObject({
      qboCustomerId: '999',
      active: false,
      deactivated: false,
      alreadyInactive: true,
    });
    expect(api.mutateEntity).not.toHaveBeenCalled();
  });

  it('sends sparse: true with Id and SyncToken, and purges what still reads the job as active', async () => {
    const result = await service.deactivateJob(confirmed('501'));

    expect(api.mutateEntity).toHaveBeenCalledWith('realm-1', 'Customer', {
      Id: '501',
      SyncToken: '0',
      sparse: true,
      Active: false,
    });
    expect(result).toMatchObject({
      qboCustomerId: '501',
      active: false,
      deactivated: true,
      alreadyInactive: false,
    });
    expect(financials.invalidateJobIndex).toHaveBeenCalled();
    expect(api.clearReadCache).toHaveBeenCalled();
  });

  it('reads the Customer with a purged cache, so the balance guard never sees a stale amount', async () => {
    await service.deactivateJob(confirmed('501'));

    const purgeOrder = api.clearReadCache.mock.invocationCallOrder[0];
    const readOrder = api.getCustomer.mock.invocationCallOrder[0];
    expect(purgeOrder).toBeLessThan(readOrder);
  });

  it('passes a QuickBooks rejection through verbatim', async () => {
    api.mutateEntity.mockRejectedValue({
      response: {
        data: {
          Fault: {
            Error: [
              {
                Message: 'Object Has Been Deleted',
                Detail: 'Object Specified does not exist.',
              },
            ],
          },
        },
      },
    });

    await expect(service.deactivateJob(confirmed('501'))).rejects.toThrow(
      'QuickBooks rejected deactivating job 501: Object Has Been Deleted — Object Specified does not exist.',
    );
  });
});
