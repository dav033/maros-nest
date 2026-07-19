import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { Lead } from '../../../entities/lead.entity';
import { Project } from '../../../entities/project.entity';
import { LeadsService } from './leads.service';

describe('LeadsService.updateLead', () => {
  let service: LeadsService;
  let lead: Lead;
  let storedProject: Project | null;
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
      name: 'Test lead',
      status: LeadStatus.CONTACTED,
      attachments: ['estimates/001.pdf'],
      contact: { id: 2, name: 'Test contact', email: 'test@example.com' },
      inReview: false,
    });
    storedProject = null;
    transactionCommitted = false;
    mailObservedCommit = false;

    leadTransactionRepo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(lead)),
      count: jest.fn().mockResolvedValue(0),
      save: jest
        .fn()
        .mockImplementation((entity: Lead) => Promise.resolve(entity)),
    };
    projectTransactionRepo = {
      findOne: jest
        .fn()
        .mockImplementation(() => Promise.resolve(storedProject)),
      create: jest
        .fn()
        .mockImplementation((values: Partial<Project>) =>
          Object.assign(new Project(), values),
        ),
      save: jest.fn().mockImplementation((project: Project) => {
        project.id = 10;
        storedProject = project;
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

    injectedLeadRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    injectedProjectRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const leadMutationService = {
      isNotesOnlyUpdate: jest.fn().mockReturnValue(false),
      updateEntityFields: jest.fn().mockImplementation((dto, entity: Lead) => {
        if (dto.status !== undefined) entity.status = dto.status;
        return Promise.resolve();
      }),
    };
    mailService = {
      sendMail: jest.fn().mockImplementation(() => {
        mailObservedCommit = transactionCommitted;
        return Promise.resolve({ messageId: 'message-1' });
      }),
    };

    service = new LeadsService(
      {} as never,
      injectedLeadRepo as never,
      {} as never,
      injectedProjectRepo as never,
      { toDto: jest.fn((entity: Lead) => ({ id: entity.id })) } as never,
      {} as never,
      {} as never,
      leadMutationService as never,
      dataSource as never,
      {} as never,
      mailService as never,
    );
  });

  it('creates the project in the transaction and notifies after commit', async () => {
    const result = await service.updateLead(lead.id, {
      status: LeadStatus.WON,
    });

    expect(result.conversion).toEqual({ converted: true, projectId: 10 });
    expect(projectTransactionRepo.save).toHaveBeenCalledTimes(1);
    expect(injectedLeadRepo.save).not.toHaveBeenCalled();
    expect(injectedProjectRepo.save).not.toHaveBeenCalled();
    expect(leadTransactionRepo.findOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailObservedCommit).toBe(true);
  });

  it('does not duplicate the project or notification on a repeated WON update', async () => {
    await service.updateLead(lead.id, { status: LeadStatus.WON });
    const secondResult = await service.updateLead(lead.id, {
      status: LeadStatus.WON,
    });

    expect(secondResult.conversion).toEqual({ converted: false });
    expect(projectTransactionRepo.save).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('repairs a WON lead that has no project', async () => {
    lead.status = LeadStatus.WON;

    const result = await service.updateLead(lead.id, {
      status: LeadStatus.WON,
    });

    expect(result.conversion).toEqual({ converted: true, projectId: 10 });
    expect(projectTransactionRepo.save).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not notify when project persistence fails', async () => {
    projectTransactionRepo.save.mockRejectedValueOnce(
      new Error('project write failed'),
    );

    await expect(
      service.updateLead(lead.id, { status: LeadStatus.WON }),
    ).rejects.toThrow('project write failed');

    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(transactionCommitted).toBe(false);
    expect(injectedLeadRepo.save).not.toHaveBeenCalled();
    expect(injectedProjectRepo.save).not.toHaveBeenCalled();
  });
});
