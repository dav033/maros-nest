import { Lead } from '../../../../entities/lead.entity';
import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { LeadMutationService } from './lead-mutation.service';

describe('LeadMutationService sales fields', () => {
  let service: LeadMutationService;
  let lead: Lead;

  beforeEach(() => {
    service = new LeadMutationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    lead = Object.assign(new Lead(), {
      id: 1,
      status: LeadStatus.CONTACTED,
      ownerId: 4,
      source: 'website',
      lostReason: 'price',
      nextFollowUpAt: '2026-03-01',
    });
  });

  it('assigns the sales fields it is given', async () => {
    await service.updateEntityFields(
      {
        ownerId: 9,
        source: 'referral',
        lostReason: 'competitor',
        nextFollowUpAt: '2026-04-15',
      },
      lead,
    );

    expect(lead.ownerId).toBe(9);
    expect(lead.source).toBe('referral');
    expect(lead.lostReason).toBe('competitor');
    expect(lead.nextFollowUpAt).toBe('2026-04-15');
  });

  // The whole point of typing these columns `| null`: TypeORM omits undefined columns from
  // the UPDATE, so a clear written as undefined would report success and change nothing.
  it('writes null, never undefined, when a sales field is cleared', async () => {
    await service.updateEntityFields(
      {
        ownerId: null,
        source: null,
        lostReason: null,
        nextFollowUpAt: null,
      },
      lead,
    );

    expect(lead.ownerId).toBeNull();
    expect(lead.source).toBeNull();
    expect(lead.lostReason).toBeNull();
    expect(lead.nextFollowUpAt).toBeNull();
    for (const field of ['ownerId', 'source', 'lostReason', 'nextFollowUpAt'] as const) {
      expect(lead[field]).not.toBeUndefined();
    }
  });

  it('leaves the sales fields untouched when the patch omits them', async () => {
    await service.updateEntityFields({ name: 'Renamed' }, lead);

    expect(lead.ownerId).toBe(4);
    expect(lead.source).toBe('website');
    expect(lead.lostReason).toBe('price');
    expect(lead.nextFollowUpAt).toBe('2026-03-01');
  });

  describe('isNotesOnlyUpdate', () => {
    it('takes the fast path for a patch that carries nothing but notes', () => {
      expect(service.isNotesOnlyUpdate({ notes: ['a'] })).toBe(true);
    });

    it.each(
      ['ownerId', 'source', 'lostReason', 'nextFollowUpAt'] as const,
    )('refuses the notes-only fast path when %s rides along', (field) => {
      const patch = { notes: ['a'], [field]: null } as never;
      expect(service.isNotesOnlyUpdate(patch)).toBe(false);
    });
  });
});
