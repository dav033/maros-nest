import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { ProjectsService } from './projects.service';

describe('ProjectsService.create', () => {
  let service: ProjectsService;
  let lead: Lead;
  let transactionCommitted: boolean;
  let mailObservedCommit: boolean;
  let leadTransactionRepo: Record<string, jest.Mock>;
  let projectTransactionRepo: Record<string, jest.Mock>;
  let injectedLeadRepo: Record<string, jest.Mock>;
  let injectedProjectRepo: Record<string, jest.Mock>;
  let mailService: Record<string, jest.Mock>;

  beforeEach(() => {
    lead = Object.assign(new Lead(), {
      id: 1,
      leadNumber: '001-0726',
      status: LeadStatus.CONTACTED,
      attachments: ['estimates/001.pdf'],
      contact: { id: 2, email: 'test@example.com' },
    });
    transactionCommitted = false;
    mailObservedCommit = false;

    leadTransactionRepo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(lead)),
      save: jest
        .fn()
        .mockImplementation((entity: Lead) => Promise.resolve(entity)),
    };
    projectTransactionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((project: Project) => {
        project.id = 10;
        return Promise.resolve(project);
      }),
    };
    const manager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === Lead) return leadTransactionRepo;
        if (entity === Project) return projectTransactionRepo;
        throw new Error(`Unexpected repository: ${entity?.name}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn().mockImplementation(async (callback) => {
        const result = await callback(manager);
        transactionCommitted = true;
        return result;
      }),
    };
    const projectMapper = {
      toEntity: jest.fn(() => Object.assign(new Project(), { attachments: [] })),
      toDto: jest.fn((project: Project) => ({ id: project.id })),
    };

    injectedLeadRepo = { findOne: jest.fn(), save: jest.fn() };
    injectedProjectRepo = { findOne: jest.fn(), save: jest.fn() };
    mailService = {
      sendMail: jest.fn().mockImplementation(() => {
        mailObservedCommit = transactionCommitted;
        return Promise.resolve({ messageId: 'message-1' });
      }),
    };

    service = new ProjectsService(
      {} as never,
      injectedProjectRepo as never,
      injectedLeadRepo as never,
      projectMapper as never,
      {} as never,
      {} as never,
      {} as never,
      mailService as never,
      dataSource as never,
    );
  });

  it('locks the lead and persists project and status in one transaction', async () => {
    const result = await service.create({ leadId: lead.id });

    expect(result).toEqual({ id: 10 });
    expect(lead.status).toBe(LeadStatus.WON);
    expect(projectTransactionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lead,
        attachments: ['estimates/001.pdf'],
      }),
    );
    expect(leadTransactionRepo.findOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(injectedLeadRepo.save).not.toHaveBeenCalled();
    expect(injectedProjectRepo.save).not.toHaveBeenCalled();
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailObservedCommit).toBe(true);
  });

  it('rejects an existing project before writing or notifying', async () => {
    projectTransactionRepo.findOne.mockResolvedValueOnce(
      Object.assign(new Project(), { id: 99 }),
    );

    await expect(service.create({ leadId: lead.id })).rejects.toThrow(
      'already has a project',
    );

    expect(projectTransactionRepo.save).not.toHaveBeenCalled();
    expect(leadTransactionRepo.save).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.getProjectPayments', () => {
  it('adds details for the invoices linked to each payment', async () => {
    const projectRepo = {
      findOne: jest.fn().mockResolvedValue({ lead: { leadNumber: '001-0726' } }),
    };
    const qboFinancials = {
      getPaymentsByProject: jest.fn().mockResolvedValue([
        {
          entityId: 'payment-1',
          txnDate: '2026-05-23',
          totalAmount: 40000,
          account: { name: 'Checking' },
          docNumber: 'PAY-01',
          linkedTxn: [{ txnId: 'invoice-1', txnType: 'Invoice' }],
          openBalance: 0,
          memo: 'Initial payment',
          attachments: [],
          warnings: [],
        },
      ]),
      getInvoicesByProject: jest.fn().mockResolvedValue([
        { entityId: 'invoice-1', docNumber: 'INV-01', totalAmount: 40000 },
      ]),
    };
    const service = new ProjectsService(
      {} as never,
      projectRepo as never,
      {} as never,
      {} as never,
      {} as never,
      qboFinancials as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.getProjectPayments(1);

    expect(qboFinancials.getInvoicesByProject).toHaveBeenCalledWith('001-0726');
    expect(result.items[0].linkedInvoices).toEqual([
      { id: 'invoice-1', documentNumber: 'INV-01', amount: 40000 },
    ]);
  });
});

describe('ProjectsService.findAllFinancials caching', () => {
  const buildService = () => {
    const projectRepo = {
      find: jest.fn().mockResolvedValue([
        Object.assign(new Project(), { id: 1, lead: { leadNumber: '001-0726' } }),
      ]),
    };
    const qboEnrichment = {
      enrichProjectsSummary: jest.fn().mockImplementation((shims: any[]) => {
        for (const shim of shims) {
          shim.financial = { projectNumber: '001-0726', total: 100 };
          shim.qbo = { data: {} };
        }
        return Promise.resolve(shims);
      }),
    };
    const service = new ProjectsService(
      {} as never,
      projectRepo as never,
      {} as never,
      {} as never,
      qboEnrichment as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, projectRepo, qboEnrichment };
  };

  const financeUser = { permissions: ['finance:read'] } as never;
  const taskOnlyUser = { permissions: ['tasks:read'] } as never;

  it('serves repeat calls from cache instead of re-querying QuickBooks', async () => {
    const { service, qboEnrichment } = buildService();

    const first = await service.findAllFinancials(financeUser);
    const second = await service.findAllFinancials(financeUser);

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(qboEnrichment.enrichProjectsSummary.mock.calls).toHaveLength(1);
  });

  it('never serves the cached payload to a user without finance:read', async () => {
    const { service } = buildService();

    // Warm the cache with a privileged caller first.
    const privileged = await service.findAllFinancials(financeUser);
    expect(privileged).toHaveLength(1);

    const denied = await service.findAllFinancials(taskOnlyUser);
    expect(denied).toEqual([]);
  });

  it('does not populate the cache from an unprivileged caller', async () => {
    const { service, qboEnrichment } = buildService();

    expect(await service.findAllFinancials(taskOnlyUser)).toEqual([]);
    expect(qboEnrichment.enrichProjectsSummary).not.toHaveBeenCalled();

    expect(await service.findAllFinancials(financeUser)).toHaveLength(1);
    expect(qboEnrichment.enrichProjectsSummary.mock.calls).toHaveLength(1);
  });

  it('collapses concurrent cold requests into a single QuickBooks pass', async () => {
    const { service, qboEnrichment } = buildService();

    const results = await Promise.all([
      service.findAllFinancials(financeUser),
      service.findAllFinancials(financeUser),
      service.findAllFinancials(financeUser),
    ]);

    expect(results.every((r) => r.length === 1)).toBe(true);
    expect(qboEnrichment.enrichProjectsSummary.mock.calls).toHaveLength(1);
  });

  it('clearFinancialsCache forces the next call to recompute', async () => {
    const { service, qboEnrichment } = buildService();

    await service.findAllFinancials(financeUser);
    service.clearFinancialsCache();
    await service.findAllFinancials(financeUser);

    expect(qboEnrichment.enrichProjectsSummary.mock.calls).toHaveLength(2);
  });
});

describe('ProjectsService.updateProjectEstimate', () => {
  const buildService = (opts: { syncFails?: boolean; leadNumber?: string | null } = {}) => {
    const projectRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        lead: { id: 3, leadNumber: opts.leadNumber === undefined ? '001-0726' : opts.leadNumber },
      }),
    };
    const leadRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const qboFinancials = {
      setProjectEstimateTotal: opts.syncFails
        ? jest.fn().mockRejectedValue(new Error('El proyecto no está vinculado a un job'))
        : jest.fn().mockResolvedValue({ entityId: 'estimate-1' }),
      getProjectFinancials: jest
        .fn()
        .mockResolvedValue([{ projectNumber: '001-0726', estimatedAmount: 870.4 }]),
    };
    const service = new ProjectsService(
      {} as never,
      projectRepo as never,
      leadRepo as never,
      {} as never,
      {} as never,
      qboFinancials as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, leadRepo, qboFinancials };
  };

  it('saves the amount on the lead and reports the QuickBooks sync', async () => {
    const { service, leadRepo, qboFinancials } = buildService();

    const result = await service.updateProjectEstimate(7, 870.404);

    expect(leadRepo.update).toHaveBeenCalledWith({ id: 3 }, { estimate: 870.4 });
    expect(qboFinancials.setProjectEstimateTotal).toHaveBeenCalledWith('001-0726', 870.4);
    expect(result).toMatchObject({ savedAmount: 870.4, synced: true, syncError: null });
  });

  it('keeps the saved amount when QuickBooks refuses the sync', async () => {
    const { service, leadRepo } = buildService({ syncFails: true });

    const result = await service.updateProjectEstimate(7, 1200);

    expect(leadRepo.update).toHaveBeenCalledWith({ id: 3 }, { estimate: 1200 });
    expect(result.savedAmount).toBe(1200);
    expect(result.synced).toBe(false);
    expect(result.syncError).toContain('no está vinculado');
  });

  it('saves without syncing when the project has no lead number', async () => {
    const { service, leadRepo, qboFinancials } = buildService({ leadNumber: null });

    const result = await service.updateProjectEstimate(7, 500);

    expect(leadRepo.update).toHaveBeenCalledWith({ id: 3 }, { estimate: 500 });
    expect(qboFinancials.setProjectEstimateTotal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ savedAmount: 500, synced: false });
  });

  it('rejects a negative amount before touching anything', async () => {
    const { service, leadRepo } = buildService();
    await expect(service.updateProjectEstimate(7, -1)).rejects.toThrow();
    expect(leadRepo.update).not.toHaveBeenCalled();
  });
});
