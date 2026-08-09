import { NotesService } from './notes.service';
import { NoteMapper } from './mappers/note.mapper';
import { NoteAccessService, NoteActor } from './services/note-access.service';
import { NotePage } from '../../../entities/note-page.entity';
import {
  NoteAccessDeniedException,
  NoteFolderHasNoContentException,
  NoteNotFoundException,
  NotePageStaleContentException,
} from '../../../common/exceptions';

/** A signed-in user. `canWrite` mirrors holding the `notes:write` permission. */
function actor(id: number, canWrite = true, roleId: number | null = null): NoteActor {
  return { id, roleId, canWrite };
}

/** Shorthand for the two columns that decide access before any grant is consulted. */
function page(overrides: Partial<NotePage> = {}): NotePage {
  return Object.assign(new NotePage(), {
    id: 1,
    title: 'Doc',
    content: {},
    visibility: 'team',
    ownerId: null,
    ...overrides,
  });
}

function makeService(
  notesRepository: Record<string, jest.Mock>,
  noteTagsRepository: Record<string, jest.Mock> = {},
  noteTreeService: Record<string, jest.Mock> = {},
  sharesRepository: Record<string, jest.Mock> = {},
) {
  const shares = {
    // No grants unless a test says otherwise: these cases are about ownership and
    // visibility, which resolve before the grant lookup is even reached.
    findEffectiveGrants: jest.fn().mockResolvedValue([]),
    findSharedPageIds: jest.fn().mockResolvedValue(new Set<number>()),
    ...sharesRepository,
  };

  return new NotesService(
    {
      // Every read stamps isFavorite from the caller's starred set; tests that aren't
      // about favorites get an empty one rather than repeating the mock everywhere.
      findFavoriteIds: jest.fn().mockResolvedValue(new Set<number>()),
      ...notesRepository,
    } as never,
    noteTagsRepository as never,
    shares as never,
    { findPublishedPageIds: jest.fn().mockResolvedValue(new Set<number>()) } as never,
    noteTreeService as never,
    // The real access service, not a stub: these tests are largely *about* access, and
    // a mock that always says yes would pass no matter what the rules did.
    new NoteAccessService(shares as never),
    new NoteMapper(),
  );
}

describe('NotesService.createNote', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    // Writes re-read the row so the response carries the joined editor, so the
    // findByIdActive mock has to answer with whatever was last saved.
    let saved: NotePage | null = null;
    notesRepository = {
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((p: NotePage) => {
        saved = Object.assign(p, { id: 1 });
        return Promise.resolve(saved);
      }),
    };

    service = makeService(notesRepository);
  });

  it('creates a root page with the first position step when no parent is given', async () => {
    const result = await service.createNote({ title: 'Meeting notes' });

    expect(notesRepository.getMaxPositionUnderParent).toHaveBeenCalledWith(null);
    expect(notesRepository.save).toHaveBeenCalledTimes(1);
    const savedPage = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(savedPage.position).toBe(1000);
    expect(savedPage.parent).toBeNull();
    expect(result.title).toBe('Meeting notes');
  });

  it('defaults an empty title to Untitled', async () => {
    const result = await service.createNote({ title: '   ' });
    expect(result.title).toBe('Untitled');
  });

  it('links to the parent page when parentId is given', async () => {
    const parent = page({ id: 5 });
    notesRepository.findByIdActive.mockResolvedValue(parent);

    await service.createNote({ title: 'Child', parentId: 5 }, actor(9));

    expect(notesRepository.findByIdActive).toHaveBeenCalledWith(5);
    const savedPage = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(savedPage.parent).toBe(parent);
  });

  it('throws NoteNotFoundException when parentId does not resolve to an active page', async () => {
    notesRepository.findByIdActive.mockResolvedValue(null);

    await expect(
      service.createNote({ title: 'Orphan', parentId: 999 }),
    ).rejects.toThrow(NoteNotFoundException);
  });

  it('starts a standalone note private to its creator', async () => {
    await service.createNote({ title: 'Scratch' }, actor(5));

    const saved = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(saved.visibility).toBe('private');
    expect(saved.ownerId).toBe(5);
  });

  it('starts an entity-linked note visible to the team', async () => {
    await service.createNote(
      { title: 'Site visit', entityKind: 'lead', entityId: 42 },
      actor(5),
    );

    const saved = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(saved.visibility).toBe('team');
  });

  it('keeps a child of a team folder reachable, so an inherited grant still covers it', async () => {
    notesRepository.findByIdActive.mockResolvedValue(page({ id: 5, visibility: 'team' }));

    await service.createNote({ title: 'Child', parentId: 5 }, actor(9));

    const saved = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(saved.visibility).toBe('team');
  });
});

describe('NotesService.updateNoteContent', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;
  let doc: NotePage;

  beforeEach(() => {
    doc = page({ id: 1, updatedAt: new Date('2026-01-01T10:00:00.000Z') });
    notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(doc),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    service = makeService(notesRepository);
  });

  it('rejects a save whose expectedUpdatedAt no longer matches the row', async () => {
    await expect(
      service.updateNoteContent(
        1,
        { content: {}, expectedUpdatedAt: '2026-01-01T09:00:00.000Z' },
        actor(5),
      ),
    ).rejects.toThrow(NotePageStaleContentException);
    expect(notesRepository.save).not.toHaveBeenCalled();
  });

  it('saves when expectedUpdatedAt matches', async () => {
    await service.updateNoteContent(
      1,
      { content: { type: 'doc' }, expectedUpdatedAt: '2026-01-01T10:00:00.000Z' },
      actor(5),
    );

    expect(notesRepository.save).toHaveBeenCalledTimes(1);
  });

  it('saves without a check when the client sends no expectedUpdatedAt', async () => {
    await service.updateNoteContent(1, { content: {} }, actor(5));
    expect(notesRepository.save).toHaveBeenCalledTimes(1);
  });
});

describe('NotesService — visibility', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    let saved: NotePage | null = null;
    notesRepository = {
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      findById: jest.fn(),
      getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((p: NotePage) => {
        saved = Object.assign(p, { id: p.id ?? 1 });
        return Promise.resolve(saved);
      }),
      trashSubtree: jest.fn().mockResolvedValue(undefined),
    };
    service = makeService(notesRepository);
  });

  it('lets the owner read their own private note', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'private', ownerId: 5 }),
    );

    await expect(service.getNoteById(1, actor(5))).resolves.toMatchObject({ id: 1 });
  });

  it("hides another user's private note as 404, not as 403", async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'private', ownerId: 5 }),
    );

    // The distinction matters: a 403 would confirm the note exists to anyone
    // walking ids, which is exactly what the 404 is there to deny.
    await expect(service.getNoteById(1, actor(6))).rejects.toThrow(
      NoteAccessDeniedException,
    );
  });

  it('blocks a non-owner from editing a private note', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'private', ownerId: 5 }),
    );

    await expect(
      service.updateNote(1, { title: 'Hijacked' }, actor(6)),
    ).rejects.toThrow(NoteAccessDeniedException);
  });

  it('blocks a non-owner from trashing a private note', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'private', ownerId: 5 }),
    );

    await expect(service.trashNote(1, actor(6))).rejects.toThrow(
      NoteAccessDeniedException,
    );
    expect(notesRepository.trashSubtree).not.toHaveBeenCalled();
  });

  it('lets anyone read a team note regardless of who owns it', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'team', ownerId: 5 }),
    );

    await expect(service.getNoteById(1, actor(999))).resolves.toMatchObject({ id: 1 });
  });

  it('gives a reader without notes:write viewer access only', async () => {
    notesRepository.findByIdActive.mockResolvedValue(page({ visibility: 'team' }));

    await expect(
      service.getNoteById(1, actor(999, false)),
    ).resolves.toMatchObject({ myAccess: 'viewer' });
    await expect(
      service.updateNote(1, { title: 'Nope' }, actor(999, false)),
    ).rejects.toThrow(NoteAccessDeniedException);
  });

  it('MCP (no actor) reads a private note that would otherwise be hidden', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'private', ownerId: 5 }),
    );

    await expect(service.getNoteById(1)).resolves.toMatchObject({ id: 1 });
  });

  it('claims an ownerless note when it is made private, so it stays reachable', async () => {
    // Without this, 'private' on a note with no owner would mean nobody at all —
    // including whoever just set it.
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'team', ownerId: null }),
    );

    await service.setVisibility(1, { visibility: 'private' }, actor(7));

    const saved = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(saved.visibility).toBe('private');
    expect(saved.ownerId).toBe(7);
  });

  it('refuses to change visibility for someone who is not the owner', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      page({ visibility: 'private', ownerId: 5 }),
    );

    await expect(
      service.setVisibility(1, { visibility: 'team' }, actor(6)),
    ).rejects.toThrow(NoteAccessDeniedException);
  });
});

describe('NotesService — grants', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;
  let shares: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findByIdActive: jest
        .fn()
        .mockResolvedValue(page({ visibility: 'private', ownerId: 5 })),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    shares = { findEffectiveGrants: jest.fn().mockResolvedValue([]) };
    service = makeService(notesRepository, {}, {}, shares);
  });

  it('opens a private note to someone holding a direct grant', async () => {
    shares.findEffectiveGrants.mockResolvedValue([
      { access: 'viewer', grantedOnPageId: 1, grantedOnTitle: 'Doc' },
    ]);

    await expect(service.getNoteById(1, actor(6))).resolves.toMatchObject({
      myAccess: 'viewer',
    });
  });

  it('honours a grant written on an ancestor, not just on the page itself', async () => {
    shares.findEffectiveGrants.mockResolvedValue([
      { access: 'editor', grantedOnPageId: 99, grantedOnTitle: 'Riverside' },
    ]);

    await expect(
      service.updateNote(1, { title: 'Renamed' }, actor(6)),
    ).resolves.toBeDefined();
  });

  it('takes the strongest grant when several reach the same page', async () => {
    shares.findEffectiveGrants.mockResolvedValue([
      { access: 'viewer', grantedOnPageId: 99, grantedOnTitle: 'Riverside' },
      { access: 'editor', grantedOnPageId: 1, grantedOnTitle: 'Doc' },
    ]);

    await expect(service.getNoteById(1, actor(6))).resolves.toMatchObject({
      myAccess: 'editor',
    });
  });

  it('ignores a grant once it has expired — the repository filters those out', async () => {
    shares.findEffectiveGrants.mockResolvedValue([]);

    await expect(service.getNoteById(1, actor(6))).rejects.toThrow(
      NoteAccessDeniedException,
    );
  });

  it('does not let a viewer edit', async () => {
    shares.findEffectiveGrants.mockResolvedValue([
      { access: 'viewer', grantedOnPageId: 1, grantedOnTitle: 'Doc' },
    ]);

    await expect(
      service.updateNote(1, { title: 'Nope' }, actor(6)),
    ).rejects.toThrow(NoteAccessDeniedException);
  });

  it('treats commenter as read-only until the comments UI exists', async () => {
    shares.findEffectiveGrants.mockResolvedValue([
      { access: 'commenter', grantedOnPageId: 1, grantedOnTitle: 'Doc' },
    ]);

    await expect(service.getNoteById(1, actor(6))).resolves.toMatchObject({
      myAccess: 'commenter',
    });
    await expect(
      service.updateNote(1, { title: 'Nope' }, actor(6)),
    ).rejects.toThrow(NoteAccessDeniedException);
  });

  it('never lets a grant reach owner-only actions like publishing', async () => {
    shares.findEffectiveGrants.mockResolvedValue([
      { access: 'editor', grantedOnPageId: 1, grantedOnTitle: 'Doc' },
    ]);

    await expect(
      service.setVisibility(1, { visibility: 'team' }, actor(6)),
    ).rejects.toThrow(NoteAccessDeniedException);
  });
});

describe('NotesService — per-user favorites', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(page()),
      findFavoriteIds: jest.fn().mockResolvedValue(new Set<number>()),
      findFavorites: jest.fn().mockResolvedValue([]),
      addFavorite: jest.fn().mockResolvedValue(undefined),
      removeFavorite: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    service = makeService(notesRepository);
  });

  it('stars the page for the acting user only', async () => {
    notesRepository.findFavoriteIds.mockResolvedValue(new Set([1]));

    const result = await service.setFavorite(1, true, actor(5));

    expect(notesRepository.addFavorite).toHaveBeenCalledWith(1, 5);
    expect(result.isFavorite).toBe(true);
  });

  it('unstars through the join table rather than a column on the page', async () => {
    const result = await service.setFavorite(1, false, actor(5));

    expect(notesRepository.removeFavorite).toHaveBeenCalledWith(1, 5);
    expect(result.isFavorite).toBe(false);
  });

  it("reports a page as unstarred when it is not in the reader's set", async () => {
    notesRepository.findFavoriteIds.mockResolvedValue(new Set([99]));

    await expect(service.getNoteById(1, actor(6))).resolves.toMatchObject({
      isFavorite: false,
    });
  });

  it('does nothing for the MCP context, which has no user to star for', async () => {
    await service.setFavorite(1, true);

    expect(notesRepository.addFavorite).not.toHaveBeenCalled();
    expect(notesRepository.removeFavorite).not.toHaveBeenCalled();
  });

  it('lets a viewer star a note they cannot edit', async () => {
    notesRepository.findByIdActive.mockResolvedValue(page({ visibility: 'team' }));

    await service.setFavorite(1, true, actor(6, false));

    expect(notesRepository.addFavorite).toHaveBeenCalledWith(1, 6);
  });
});

describe('NotesService — authorship', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;
  let doc: NotePage;

  beforeEach(() => {
    doc = page();
    notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(doc),
      addFavorite: jest.fn().mockResolvedValue(undefined),
      removeFavorite: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    service = makeService(notesRepository);
  });

  it('stamps the editor when the content changes', async () => {
    await service.updateNoteContent(1, { content: {} }, actor(7));

    expect((notesRepository.save.mock.calls[0] as [NotePage])[0].lastEditedById).toBe(7);
  });

  it('stamps the editor when the title changes', async () => {
    await service.updateNote(1, { title: 'Renamed' }, actor(7));

    expect((notesRepository.save.mock.calls[0] as [NotePage])[0].lastEditedById).toBe(7);
  });

  it('does not count starring as an edit', async () => {
    doc.lastEditedById = 3;

    await service.setFavorite(1, true, actor(7));

    expect(doc.lastEditedById).toBe(3);
  });
});

describe('NotesService — folders', () => {
  it('refuses to write a document into a folder', async () => {
    const folder = page({ kind: 'folder' });
    const notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(folder),
      save: jest.fn(),
    };
    const service = makeService(notesRepository);

    await expect(
      service.updateNoteContent(1, { content: {} }, actor(5)),
    ).rejects.toThrow(NoteFolderHasNoContentException);
    expect(notesRepository.save).not.toHaveBeenCalled();
  });

  it('creates a folder when kind says so', async () => {
    let saved: NotePage | null = null;
    const notesRepository = {
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((p: NotePage) => {
        saved = Object.assign(p, { id: 1 });
        return Promise.resolve(saved);
      }),
    };
    const service = makeService(notesRepository);

    const result = await service.createNote(
      { title: 'Riverside', kind: 'folder' },
      actor(5),
    );

    expect(result.kind).toBe('folder');
  });
});

describe('NotesService.setEntityLink', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;
  let doc: NotePage;

  beforeEach(() => {
    doc = page();
    notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(doc),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    service = makeService(notesRepository);
  });

  it('links the note to a lead', async () => {
    await service.setEntityLink(1, { entityKind: 'lead', entityId: 42 }, actor(5));

    expect(doc.entityKind).toBe('lead');
    expect(doc.entityId).toBe(42);
  });

  it('writes real nulls when unlinking, not undefined', async () => {
    doc.entityKind = 'lead';
    doc.entityId = 42;

    await service.setEntityLink(1, { entityKind: null, entityId: null }, actor(5));

    expect(doc.entityKind).toBeNull();
    expect(doc.entityId).toBeNull();
  });

  it('leaves ownership and visibility alone when unlinking', async () => {
    // Unlinking used to have to clear owner_id, because privacy was inferred from
    // "standalone and owned". visibility is its own column now, so the entity link and
    // who can read the note are independent and that workaround is gone.
    doc.entityKind = 'lead';
    doc.entityId = 42;
    doc.ownerId = 5;
    doc.visibility = 'team';

    await service.setEntityLink(1, { entityKind: null, entityId: null }, actor(6));

    expect(doc.ownerId).toBe(5);
    expect(doc.visibility).toBe('team');
  });
});
