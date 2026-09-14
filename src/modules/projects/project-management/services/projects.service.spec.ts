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
