import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { Lead } from '../../../entities/lead.entity';
import { LeadStatusEvent } from '../../../entities/lead-status-event.entity';
import { Project } from '../../../entities/project.entity';
import { LeadExceptions } from '../../../common/exceptions';
import { LeadsService } from './leads.service';

describe('LeadsService.updateLead', () => {
  let service: LeadsService;
  let lead: Lead;
  let storedProject: Project | null;
  let transactionCommitted: boolean;
  let mailObservedCommit: boolean;
  let leadTransactionRepo: Record<string, jest.Mock>;
  let projectTransactionRepo: Record<string, jest.Mock>;
  let statusEventTransactionRepo: Record<string, jest.Mock>;
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

    statusEventTransactionRepo = {
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
    };

    const manager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === Lead) return leadTransactionRepo;
        if (entity === Project) return projectTransactionRepo;
        if (entity === LeadStatusEvent) return statusEventTransactionRepo;
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
        if (dto.lostReason !== undefined) entity.lostReason = dto.lostReason ?? null;
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

  it('records the status move and stamps status_changed_at', async () => {
    const before = Date.now();

    await service.updateLead(
      lead.id,
      { status: LeadStatus.PROPOSAL_SENT },
      { id: 7 } as never,
    );

    expect(statusEventTransactionRepo.insert).toHaveBeenCalledTimes(1);
    expect(statusEventTransactionRepo.insert).toHaveBeenCalledWith({
      leadId: 1,
      fromStatus: LeadStatus.CONTACTED,
      toStatus: LeadStatus.PROPOSAL_SENT,
      changedById: 7,
      changedAt: lead.statusChangedAt,
    });
    expect(lead.statusChangedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('records a first move with a null from_status for a lead that never had one', async () => {
    lead.status = undefined;

    await service.updateLead(lead.id, { status: LeadStatus.CONTACTED });

    expect(statusEventTransactionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: null, toStatus: LeadStatus.CONTACTED }),
    );
  });

  it('attributes the move to nobody when no user is behind the request', async () => {
    await service.updateLead(lead.id, { status: LeadStatus.FOLLOW_UP });

    expect(statusEventTransactionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ changedById: null }),
    );
  });

  it('writes no status event when the update leaves the status alone', async () => {
    await service.updateLead(lead.id, { name: 'Renamed lead' });

    expect(statusEventTransactionRepo.insert).not.toHaveBeenCalled();
    expect(lead.statusChangedAt).toBeUndefined();
    expect(leadTransactionRepo.save).toHaveBeenCalledTimes(1);
  });

  it('writes no status event when the status is re-sent unchanged', async () => {
    await service.updateLead(lead.id, { status: LeadStatus.CONTACTED });

    expect(statusEventTransactionRepo.insert).not.toHaveBeenCalled();
    expect(lead.statusChangedAt).toBeUndefined();
  });

  it('refuses to move a lead to LOST without a lost reason', async () => {
    await expect(
      service.updateLead(lead.id, { status: LeadStatus.LOST }),
    ).rejects.toBeInstanceOf(LeadExceptions.LeadLostReasonRequiredException);

    expect(leadTransactionRepo.save).not.toHaveBeenCalled();
    expect(statusEventTransactionRepo.insert).not.toHaveBeenCalled();
    expect(transactionCommitted).toBe(false);
  });

  it('refuses a move to LOST that explicitly clears the lost reason', async () => {
    lead.lostReason = 'price';

    await expect(
      service.updateLead(lead.id, { status: LeadStatus.LOST, lostReason: null }),
    ).rejects.toBeInstanceOf(LeadExceptions.LeadLostReasonRequiredException);

    expect(leadTransactionRepo.save).not.toHaveBeenCalled();
  });

  it('moves a lead to LOST when the update supplies a reason', async () => {
    const result = await service.updateLead(lead.id, {
      status: LeadStatus.LOST,
      lostReason: 'competitor',
    });

    expect(result.conversion).toEqual({ converted: false });
    expect(lead.lostReason).toBe('competitor');
    expect(statusEventTransactionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: LeadStatus.CONTACTED,
        toStatus: LeadStatus.LOST,
      }),
    );
  });

  it('moves a lead to LOST on a reason it already carries', async () => {
    lead.lostReason = 'no_response';

    await service.updateLead(lead.id, { status: LeadStatus.LOST });

    expect(statusEventTransactionRepo.insert).toHaveBeenCalledTimes(1);
  });

  // The rule guards transitions only: the 59 leads lost before lost_reason existed have
  // nobody left to ask, so editing anything else on one must not be blocked by it.
  it('lets an already-lost lead with no reason be edited', async () => {
    lead.status = LeadStatus.LOST;
    lead.lostReason = null;

    await service.updateLead(lead.id, { name: 'Renamed lost lead' });

    expect(leadTransactionRepo.save).toHaveBeenCalledTimes(1);
    expect(statusEventTransactionRepo.insert).not.toHaveBeenCalled();
  });

  it('records no event when a status is cleared, since there is no stage to record', async () => {
    await service.updateLead(lead.id, { status: null as never });

    expect(lead.status).toBeNull();
    expect(statusEventTransactionRepo.insert).not.toHaveBeenCalled();
    expect(lead.statusChangedAt).toBeUndefined();
  });
});
