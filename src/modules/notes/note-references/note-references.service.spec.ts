import { NoteReferencesService } from './note-references.service';
import { NotePage } from '../../../entities/note-page.entity';
import type { NoteReference } from '../../../entities/note-reference.entity';
import { NoteAccessService, type NoteActor } from '../note-management/services/note-access.service';
import {
  NoteNotFoundException,
  NoteReferenceTargetNotFoundException,
  NoteReferenceUnsupportedKindException,
} from '../../../common/exceptions';

function actor(id: number, canWrite = true, roleId: number | null = null): NoteActor {
  return { id, roleId, canWrite };
}

function page(overrides: Partial<NotePage> = {}): NotePage {
  return Object.assign(new NotePage(), {
    id: 1,
    title: 'Doc',
    content: {},
    visibility: 'team',
    ownerId: null,
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  });
}

function reference(overrides: Partial<NoteReference> = {}): NoteReference {
  return {
    id: 1,
    notePageId: 1,
    targetKind: 'lead',
    targetId: 42,
    origin: 'relation',
    labelSnapshot: null,
    createdById: null,
    createdAt: new Date(),
    ...overrides,
  } as NoteReference;
}

const mention = (kind: string, id: number, label?: string) => ({
  type: 'entityMention',
  attrs: { kind, id, label },
});

const docWith = (...nodes: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: nodes }],
});

function makeService(
  references: Record<string, jest.Mock> = {},
  targets: Record<string, jest.Mock> = {},
  notes: Record<string, jest.Mock> = {},
) {
  const shares = {
    findEffectiveGrants: jest.fn().mockResolvedValue([]),
    findSharedPageIds: jest.fn().mockResolvedValue(new Set<number>()),
  };

  const referencesRepo = {
    findByPage: jest.fn().mockResolvedValue([]),
    replaceInline: jest.fn().mockResolvedValue(undefined),
    addRelation: jest.fn().mockResolvedValue(undefined),
    removeRelation: jest.fn().mockResolvedValue(undefined),
    findPagesReferencing: jest.fn().mockResolvedValue([]),
    ...references,
  };

  const targetsService = {
    assertSupportedKind: jest.fn((kind: string) => {
      if (!['lead', 'project', 'contact', 'company', 'task', 'user', 'note'].includes(kind)) {
        throw new NoteReferenceUnsupportedKindException(kind);
      }
      return kind;
    }),
    assertExists: jest
      .fn()
      .mockImplementation((kind: string, id: number) =>
        Promise.resolve({ kind, id, label: `${kind} ${id}`, sublabel: null, exists: true }),
      ),
    resolve: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue([]),
    ...targets,
  };

  const notesRepo = {
    findByIdActive: jest.fn().mockResolvedValue(page()),
    save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    ...notes,
  };

  const service = new NoteReferencesService(
    referencesRepo as never,
    targetsService as never,
    notesRepo as never,
    // The real access service: these tests are partly about a backlink not becoming a
    // way to read a note you may not open.
    new NoteAccessService(shares as never),
  );

  return { service, referencesRepo, targetsService, notesRepo };
}

describe('NoteReferencesService.syncInlineFromContent', () => {
  it('writes one inline row per distinct mention in the document', async () => {
    const { service, referencesRepo } = makeService();

    await service.syncInlineFromContent(
      1,
      docWith(mention('lead', 42, 'Acme roof'), mention('task', 9, 'Order steel')),
      actor(5),
    );

    expect(referencesRepo.replaceInline).toHaveBeenCalledWith(
      1,
      [
        { targetKind: 'lead', targetId: 42, label: 'Acme roof' },
        { targetKind: 'task', targetId: 9, label: 'Order steel' },
      ],
      5,
    );
  });

  it('clears the index when the last chip is deleted from the document', async () => {
    const { service, referencesRepo } = makeService();

    await service.syncInlineFromContent(1, docWith({ type: 'text', text: 'plain prose' }), actor(5));

    expect(referencesRepo.replaceInline).toHaveBeenCalledWith(1, [], 5);
  });

  it('drops a self-link so a note never shows up as its own backlink', async () => {
    const { service, referencesRepo } = makeService();

    await service.syncInlineFromContent(
      7,
      docWith({ type: 'noteLink', attrs: { id: 7, label: 'This note' } }),
      actor(5),
    );

    expect(referencesRepo.replaceInline).toHaveBeenCalledWith(7, [], 5);
  });

  it('indexes a chip pointing at a deleted record instead of refusing the save', async () => {
    // Autosave runs this on every keystroke pause. A dead chip has to cost nothing.
    const { service, referencesRepo, targetsService } = makeService();

    await service.syncInlineFromContent(1, docWith(mention('lead', 999, 'Gone')), actor(5));

    expect(targetsService.assertExists).not.toHaveBeenCalled();
    expect(referencesRepo.replaceInline).toHaveBeenCalledWith(
      1,
      [{ targetKind: 'lead', targetId: 999, label: 'Gone' }],
      5,
    );
  });
});

describe('NoteReferencesService relations', () => {
  it('pins a record and refuses one that does not exist', async () => {
    const { service, referencesRepo, targetsService } = makeService();

    await service.addRelation(1, 'lead', 42, actor(5));
    expect(referencesRepo.addRelation).toHaveBeenCalledWith(
      1,
      { targetKind: 'lead', targetId: 42, label: 'lead 42' },
      5,
    );

    targetsService.assertExists.mockRejectedValueOnce(
      new NoteReferenceTargetNotFoundException('lead', 777),
    );
    await expect(service.addRelation(1, 'lead', 777, actor(5))).rejects.toThrow(
      NoteReferenceTargetNotFoundException,
    );
  });

  it('rejects a kind that is not referenceable', async () => {
    const { service } = makeService();

    await expect(service.addRelation(1, 'invoice', 1, actor(5))).rejects.toThrow(
      NoteReferenceUnsupportedKindException,
    );
  });

  it('refuses to pin anything on a note the user cannot edit', async () => {
    const { service, referencesRepo } = makeService({}, {}, {
      findByIdActive: jest.fn().mockResolvedValue(page({ visibility: 'private', ownerId: 99 })),
    });

    await expect(service.addRelation(1, 'lead', 42, actor(5))).rejects.toThrow();
    expect(referencesRepo.addRelation).not.toHaveBeenCalled();
  });

  it('404s on a note that is not there', async () => {
    const { service } = makeService({}, {}, { findByIdActive: jest.fn().mockResolvedValue(null) });

    await expect(service.addRelation(404, 'lead', 42, actor(5))).rejects.toThrow(
      NoteNotFoundException,
    );
  });
});

describe('NoteReferencesService.setPrimaryRelation', () => {
  it('replaces only the previous primary, leaving other pinned records alone', async () => {
    const doc = page({ entityKind: 'lead', entityId: 42 });
    const { service, referencesRepo } = makeService({
      findByPage: jest
        .fn()
        .mockResolvedValue([reference({ id: 2, targetKind: 'project', targetId: 7 })]),
    });

    await service.setPrimaryRelation(doc, 'contact', 3, actor(5));

    expect(referencesRepo.removeRelation).toHaveBeenCalledTimes(1);
    expect(referencesRepo.removeRelation).toHaveBeenCalledWith(1, 'lead', 42);
    expect(referencesRepo.addRelation).toHaveBeenCalledWith(
      1,
      { targetKind: 'contact', targetId: 3, label: 'contact 3' },
      5,
    );
  });

  /**
   * Found by driving the real endpoint: pinning three records and then calling
   * notes_set_entity(contact, 45) left the columns reading company#113, because the sync
   * re-derived "oldest eligible" and ignored the record the caller had just named. The
   * endpoint then answered with an entity link nobody asked for.
   */
  it('puts the record the caller named in the columns, even when an older relation exists', async () => {
    const doc = page({ entityKind: null, entityId: null });
    const { service } = makeService({
      findByPage: jest.fn().mockResolvedValue([
        reference({ id: 14, targetKind: 'company', targetId: 113 }),
        reference({ id: 16, targetKind: 'contact', targetId: 45 }),
      ]),
    });

    await service.setPrimaryRelation(doc, 'contact', 45, actor(5));

    expect(doc.entityKind).toBe('contact');
    expect(doc.entityId).toBe(45);
  });

  it('falls back to the oldest eligible relation when the named kind cannot be primary', async () => {
    // The DTOs only allow the four, but the method signature accepts every kind; a task
    // must not land in a column that /notes/by-entity reads as one of the four.
    const doc = page({ entityKind: null, entityId: null });
    const { service } = makeService({
      findByPage: jest.fn().mockResolvedValue([
        reference({ id: 14, targetKind: 'company', targetId: 113 }),
        reference({ id: 16, targetKind: 'task', targetId: 55 }),
      ]),
    });

    await service.setPrimaryRelation(doc, 'task', 55, actor(5));

    expect(doc.entityKind).toBe('company');
    expect(doc.entityId).toBe(113);
  });

  it('promotes the oldest remaining relation into the denormalized columns', async () => {
    const doc = page({ entityKind: 'lead', entityId: 42 });
    const { service, notesRepo } = makeService({
      findByPage: jest.fn().mockResolvedValue([
        reference({ id: 9, targetKind: 'company', targetId: 8 }),
        reference({ id: 4, targetKind: 'project', targetId: 7 }),
      ]),
    });

    await service.setPrimaryRelation(doc, null, null, actor(5));

    expect(doc.entityKind).toBe('project');
    expect(doc.entityId).toBe(7);
    expect(notesRepo.save).toHaveBeenCalledWith(doc);
  });

  it('writes real nulls when nothing is left to be primary', async () => {
    const doc = page({ entityKind: 'lead', entityId: 42 });
    const { service } = makeService({ findByPage: jest.fn().mockResolvedValue([]) });

    await service.setPrimaryRelation(doc, null, null, actor(5));

    expect(doc.entityKind).toBeNull();
    expect(doc.entityId).toBeNull();
  });

  it('never promotes a task, a colleague or another note — the columns cannot hold them', async () => {
    const doc = page({ entityKind: 'lead', entityId: 42 });
    const { service } = makeService({
      findByPage: jest.fn().mockResolvedValue([
        reference({ id: 2, targetKind: 'task', targetId: 9 }),
        reference({ id: 3, targetKind: 'user', targetId: 5 }),
        reference({ id: 4, targetKind: 'note', targetId: 6 }),
      ]),
    });

    await service.setPrimaryRelation(doc, null, null, actor(5));

    expect(doc.entityKind).toBeNull();
  });

  it('ignores inline mentions when choosing the primary', async () => {
    const doc = page({ entityKind: 'lead', entityId: 42 });
    const { service } = makeService({
      findByPage: jest
        .fn()
        .mockResolvedValue([reference({ id: 2, origin: 'inline', targetKind: 'lead', targetId: 42 })]),
    });

    await service.setPrimaryRelation(doc, null, null, actor(5));

    expect(doc.entityKind).toBeNull();
  });

  it('does not save the page when the primary has not changed', async () => {
    const doc = page({ entityKind: 'project', entityId: 7 });
    const { service, notesRepo } = makeService({
      findByPage: jest
        .fn()
        .mockResolvedValue([reference({ id: 4, targetKind: 'project', targetId: 7 })]),
    });

    await service.setPrimaryRelation(doc, 'project', 7, actor(5));

    expect(notesRepo.save).not.toHaveBeenCalled();
  });
});

describe('NoteReferencesService.listForPage', () => {
  it('shows the live name, not the one stored when the chip was made', async () => {
    const { service } = makeService(
      { findByPage: jest.fn().mockResolvedValue([reference({ labelSnapshot: 'Old name' })]) },
      {
        resolve: jest
          .fn()
          .mockResolvedValue([
            { kind: 'lead', id: 42, label: 'Renamed lead', sublabel: 'L-1042', exists: true },
          ]),
      },
    );

    const [ref] = await service.listForPage(1, actor(5));
    expect(ref.label).toBe('Renamed lead');
    expect(ref.sublabel).toBe('L-1042');
    expect(ref.exists).toBe(true);
  });

  it('falls back to the snapshot once the record is gone', async () => {
    const { service } = makeService(
      { findByPage: jest.fn().mockResolvedValue([reference({ labelSnapshot: 'Acme roof' })]) },
      {
        resolve: jest
          .fn()
          .mockResolvedValue([{ kind: 'lead', id: 42, label: '', sublabel: null, exists: false }]),
      },
    );

    const [ref] = await service.listForPage(1, actor(5));
    expect(ref.label).toBe('Acme roof');
    expect(ref.exists).toBe(false);
  });

  it('labels a deleted record with no snapshot by its kind and id, never blank', async () => {
    const { service } = makeService(
      { findByPage: jest.fn().mockResolvedValue([reference({ labelSnapshot: null })]) },
      {
        resolve: jest
          .fn()
          .mockResolvedValue([{ kind: 'lead', id: 42, label: '', sublabel: null, exists: false }]),
      },
    );

    const [ref] = await service.listForPage(1, actor(5));
    expect(ref.label).toBe('lead #42');
  });

  it('puts authored relations above the body mentions', async () => {
    const { service } = makeService(
      {
        findByPage: jest.fn().mockResolvedValue([
          reference({ id: 1, origin: 'inline', targetId: 1 }),
          reference({ id: 2, origin: 'relation', targetId: 2 }),
        ]),
      },
      {
        resolve: jest.fn().mockResolvedValue([
          { kind: 'lead', id: 1, label: 'One', sublabel: null, exists: true },
          { kind: 'lead', id: 2, label: 'Two', sublabel: null, exists: true },
        ]),
      },
    );

    const refs = await service.listForPage(1, actor(5));
    expect(refs.map((ref) => ref.origin)).toEqual(['relation', 'inline']);
  });

  it('refuses a note the caller cannot read', async () => {
    const { service } = makeService({}, {}, {
      findByIdActive: jest.fn().mockResolvedValue(page({ visibility: 'private', ownerId: 99 })),
    });

    await expect(service.listForPage(1, actor(5))).rejects.toThrow();
  });
});

describe('NoteReferencesService.listBacklinks', () => {
  it('quotes the block each link was made from', async () => {
    const source = page({
      id: 2,
      title: 'Site survey',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'follow up in ' },
              { type: 'noteLink', attrs: { id: 1, label: 'Kickoff' } },
            ],
          },
        ],
      },
    });
    const { service } = makeService({
      findPagesReferencing: jest.fn().mockResolvedValue([{ page: source, origins: ['inline'] }]),
    });

    const [backlink] = await service.listBacklinks(1, actor(5));
    expect(backlink.page.title).toBe('Site survey');
    expect(backlink.contexts).toEqual(['follow up in Kickoff']);
  });

  it('asks for backlinks excluding the note itself', async () => {
    const { service, referencesRepo } = makeService();

    await service.listBacklinks(1, actor(5));

    expect(referencesRepo.findPagesReferencing).toHaveBeenCalledWith('note', 1, actor(5), {
      excludePageId: 1,
    });
  });

  it('quotes nothing for a note that only pins this one in its header', async () => {
    const { service } = makeService({
      findPagesReferencing: jest
        .fn()
        .mockResolvedValue([{ page: page({ id: 2, title: 'Index' }), origins: ['relation'] }]),
    });

    const [backlink] = await service.listBacklinks(1, actor(5));
    expect(backlink.contexts).toEqual([]);
  });

  it('refuses backlinks for a note the caller cannot read', async () => {
    const { service } = makeService({}, {}, {
      findByIdActive: jest.fn().mockResolvedValue(page({ visibility: 'private', ownerId: 99 })),
    });

    await expect(service.listBacklinks(1, actor(5))).rejects.toThrow();
  });

  it('titles an untitled source note rather than returning an empty string', async () => {
    const { service } = makeService({
      findPagesReferencing: jest
        .fn()
        .mockResolvedValue([{ page: page({ id: 2, title: '' }), origins: ['relation'] }]),
    });

    const [backlink] = await service.listBacklinks(1, actor(5));
    expect(backlink.page.title).toBe('Untitled');
  });
});

describe('NoteReferencesService.search', () => {
  it('searches every kind when none is named', async () => {
    const { service, targetsService } = makeService();

    await service.search('acme', [], 5, actor(5));

    expect(targetsService.search).toHaveBeenCalledWith(
      'acme',
      ['lead', 'project', 'contact', 'company', 'task', 'user', 'note'],
      5,
      actor(5),
    );
  });

  it('narrows to the kinds asked for', async () => {
    const { service, targetsService } = makeService();

    await service.search('acme', ['note'], 5, actor(5));

    expect(targetsService.search).toHaveBeenCalledWith('acme', ['note'], 5, actor(5));
  });

  it('rejects an unknown kind instead of silently searching everything', async () => {
    const { service } = makeService();

    await expect(service.search('acme', ['invoice'], 5, actor(5))).rejects.toThrow(
      NoteReferenceUnsupportedKindException,
    );
  });
});
