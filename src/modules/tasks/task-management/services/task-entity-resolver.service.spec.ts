import { TaskEntityResolverService, resolveKey } from './task-entity-resolver.service';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { Contact } from '../../../../entities/contact.entity';
import { Company } from '../../../../entities/company.entity';

function lead(overrides: Partial<Lead> = {}): Lead {
  return Object.assign(new Lead(), { id: 1, name: 'Kitchen remodel', leadNumber: '001-0100', ...overrides });
}

function project(overrides: Partial<Project> = {}): Project {
  return Object.assign(new Project(), { id: 1, lead: lead({ id: 1 }), ...overrides });
}

function contact(overrides: Partial<Contact> = {}): Contact {
  return Object.assign(new Contact(), { id: 1, name: 'Jane Homeowner', ...overrides });
}

function company(overrides: Partial<Company> = {}): Company {
  return Object.assign(new Company(), { id: 1, name: 'Acme Supply', ...overrides });
}

function makeService(overrides: {
  leadsRepo?: Record<string, jest.Mock>;
  projectsRepo?: Record<string, jest.Mock>;
  contactsRepo?: Record<string, jest.Mock>;
  companiesRepo?: Record<string, jest.Mock>;
} = {}) {
  const leadsRepo = { find: jest.fn().mockResolvedValue([]), ...overrides.leadsRepo };
  const projectsRepo = { find: jest.fn().mockResolvedValue([]), ...overrides.projectsRepo };
  const contactsRepo = { find: jest.fn().mockResolvedValue([]), ...overrides.contactsRepo };
  const companiesRepo = { find: jest.fn().mockResolvedValue([]), ...overrides.companiesRepo };

  const service = new TaskEntityResolverService(
    leadsRepo as never,
    projectsRepo as never,
    contactsRepo as never,
    companiesRepo as never,
  );

  return { service, leadsRepo, projectsRepo, contactsRepo, companiesRepo };
}

describe('TaskEntityResolverService.resolveMany', () => {
  it('queries each entity kind once with every id for that kind, not once per link', async () => {
    const { service, leadsRepo, contactsRepo } = makeService({
      leadsRepo: { find: jest.fn().mockResolvedValue([lead({ id: 1 }), lead({ id: 2, name: 'Bath remodel' })]) },
      contactsRepo: { find: jest.fn().mockResolvedValue([contact({ id: 5 })]) },
    });

    await service.resolveMany([
      { entityKind: 'lead', entityId: 1 },
      { entityKind: 'lead', entityId: 2 },
      { entityKind: 'lead', entityId: 1 }, // same lead linked from two tasks
      { entityKind: 'contact', entityId: 5 },
    ]);

    expect(leadsRepo.find).toHaveBeenCalledTimes(1);
    expect(leadsRepo.find.mock.calls[0][0].where.id.value.sort()).toEqual([1, 2]);
    expect(contactsRepo.find).toHaveBeenCalledTimes(1);
  });

  it('skips the query entirely for an entity kind nothing links to', async () => {
    const { service, projectsRepo, companiesRepo } = makeService();

    await service.resolveMany([{ entityKind: 'lead', entityId: 1 }]);

    expect(projectsRepo.find).not.toHaveBeenCalled();
    expect(companiesRepo.find).not.toHaveBeenCalled();
  });

  it('resolves a lead to its name, number and address', async () => {
    const { service } = makeService({
      leadsRepo: {
        find: jest.fn().mockResolvedValue([
          lead({ id: 42, name: 'Kitchen remodel', leadNumber: '001-0042', location: '12 Oak St', addressLink: 'https://maps/oak' }),
        ]),
      },
    });

    const result = await service.resolveMany([{ entityKind: 'lead', entityId: 42 }]);

    expect(result.get(resolveKey('lead', 42))).toEqual({
      kind: 'lead',
      id: 42,
      label: 'Kitchen remodel',
      href: '/lead/42',
      leadNumber: '001-0042',
      address: '12 Oak St',
      addressLink: 'https://maps/oak',
      status: undefined,
      jobKey: 'lead:42',
    });
  });

  it("resolves a project's name and address through its lead, not itself", async () => {
    const { service } = makeService({
      projectsRepo: {
        find: jest.fn().mockResolvedValue([
          project({ id: 7, lead: lead({ id: 7, name: 'Bath remodel', leadNumber: '001-0007', location: '9 Pine Ave' }) }),
        ]),
      },
    });

    const result = await service.resolveMany([{ entityKind: 'project', entityId: 7 }]);

    const ref = result.get(resolveKey('project', 7));
    expect(ref?.label).toBe('Bath remodel');
    expect(ref?.leadNumber).toBe('001-0007');
    expect(ref?.address).toBe('9 Pine Ave');
    expect(ref?.href).toBe('/project/7');
  });

  it('falls back to "Kind #id" when the record has no name', async () => {
    const { service } = makeService({
      leadsRepo: { find: jest.fn().mockResolvedValue([lead({ id: 9, name: undefined })]) },
    });

    const result = await service.resolveMany([{ entityKind: 'lead', entityId: 9 }]);

    expect(result.get(resolveKey('lead', 9))?.label).toBe('Lead #9');
  });

  it('resolves contacts and companies from their own name and address', async () => {
    const { service } = makeService({
      contactsRepo: { find: jest.fn().mockResolvedValue([contact({ id: 3, address: '4 Elm St' })]) },
      companiesRepo: { find: jest.fn().mockResolvedValue([company({ id: 8, address: '99 Main St' })]) },
    });

    const result = await service.resolveMany([
      { entityKind: 'contact', entityId: 3 },
      { entityKind: 'company', entityId: 8 },
    ]);

    expect(result.get(resolveKey('contact', 3))?.label).toBe('Jane Homeowner');
    expect(result.get(resolveKey('contact', 3))?.address).toBe('4 Elm St');
    expect(result.get(resolveKey('company', 8))?.label).toBe('Acme Supply');
    expect(result.get(resolveKey('company', 8))?.href).toBe('/company/8');
  });

  it('returns an empty map for no links, without querying anything', async () => {
    const { service, leadsRepo, projectsRepo, contactsRepo, companiesRepo } = makeService();

    const result = await service.resolveMany([]);

    expect(result.size).toBe(0);
    expect(leadsRepo.find).not.toHaveBeenCalled();
    expect(projectsRepo.find).not.toHaveBeenCalled();
    expect(contactsRepo.find).not.toHaveBeenCalled();
    expect(companiesRepo.find).not.toHaveBeenCalled();
  });
});
