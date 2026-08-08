import { NotesService } from './notes.service';
import { NoteMapper } from './mappers/note.mapper';
import { NotePage } from '../../../entities/note-page.entity';
import {
  NoteNotFoundException,
  NotePageStaleContentException,
} from '../../../common/exceptions';

function makeService(
  notesRepository: Record<string, jest.Mock>,
  noteTagsRepository: Record<string, jest.Mock> = {},
  noteTreeService: Record<string, jest.Mock> = {},
) {
  return new NotesService(
    notesRepository as never,
    noteTagsRepository as never,
    noteTreeService as never,
    new NoteMapper(),
  );
}

describe('NotesService.createNote', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findByIdActive: jest.fn(),
      getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((page: NotePage) =>
        Promise.resolve(Object.assign(page, { id: 1 })),
      ),
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
    const parent = Object.assign(new NotePage(), { id: 5 });
    notesRepository.findByIdActive.mockResolvedValue(parent);

    await service.createNote({ title: 'Child', parentId: 5 });

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
});

describe('NotesService.updateNoteContent', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;
  let page: NotePage;

  beforeEach(() => {
    page = Object.assign(new NotePage(), { id: 1, title: 'Doc', content: {} });
    notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(page),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    service = makeService(notesRepository);
  });

  it('extracts plain text from the TipTap doc into contentText', async () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    };

    await service.updateNoteContent(1, { content });

    const savedPage = (notesRepository.save.mock.calls[0] as [NotePage])[0];
    expect(savedPage.content).toEqual(content);
    expect(savedPage.contentText).toBe('Hello world');
  });

  it('throws NoteNotFoundException when the page does not exist', async () => {
    notesRepository.findByIdActive.mockResolvedValue(null);

    await expect(
      service.updateNoteContent(404, { content: {} }),
    ).rejects.toThrow(NoteNotFoundException);
  });

  it('saves when expectedUpdatedAt matches the stored value', async () => {
    page.updatedAt = new Date('2026-08-01T10:00:00.000Z');

    await expect(
      service.updateNoteContent(1, {
        content: {},
        expectedUpdatedAt: '2026-08-01T10:00:00.000Z',
      }),
    ).resolves.toBeDefined();
    expect(notesRepository.save).toHaveBeenCalledTimes(1);
  });

  it('throws NotePageStaleContentException when expectedUpdatedAt is stale', async () => {
    page.updatedAt = new Date('2026-08-01T10:05:00.000Z');

    await expect(
      service.updateNoteContent(1, {
        content: {},
        expectedUpdatedAt: '2026-08-01T10:00:00.000Z',
      }),
    ).rejects.toThrow(NotePageStaleContentException);
    expect(notesRepository.save).not.toHaveBeenCalled();
  });
});

describe('NotesService.trashNote', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findByIdActive: jest.fn(),
      trashSubtree: jest.fn().mockResolvedValue(undefined),
    };
    service = makeService(notesRepository);
  });

  it('trashes the subtree when the page exists', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1 }),
    );

    await service.trashNote(1);

    expect(notesRepository.trashSubtree).toHaveBeenCalledWith(1);
  });

  it('throws NoteNotFoundException when the page does not exist', async () => {
    notesRepository.findByIdActive.mockResolvedValue(null);

    await expect(service.trashNote(404)).rejects.toThrow(NoteNotFoundException);
    expect(notesRepository.trashSubtree).not.toHaveBeenCalled();
  });
});

describe('NotesService.restoreNote / purgeNote', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findById: jest.fn(),
      findByIdActive: jest.fn(),
      restoreSubtree: jest.fn().mockResolvedValue(undefined),
      purge: jest.fn().mockResolvedValue(undefined),
    };
    service = makeService(notesRepository);
  });

  it('restores the subtree and returns the fresh detail dto', async () => {
    const page = Object.assign(new NotePage(), { id: 1, title: 'Doc', content: {} });
    notesRepository.findById.mockResolvedValue(page);
    notesRepository.findByIdActive.mockResolvedValue(page);

    const result = await service.restoreNote(1);

    expect(notesRepository.restoreSubtree).toHaveBeenCalledWith(1);
    expect(result.id).toBe(1);
  });

  it('purges the page when it exists, regardless of trashed state', async () => {
    notesRepository.findById.mockResolvedValue(Object.assign(new NotePage(), { id: 1 }));

    await service.purgeNote(1);

    expect(notesRepository.purge).toHaveBeenCalledWith(1);
  });

  it('throws NoteNotFoundException when purging a page that does not exist', async () => {
    notesRepository.findById.mockResolvedValue(null);

    await expect(service.purgeNote(404)).rejects.toThrow(NoteNotFoundException);
    expect(notesRepository.purge).not.toHaveBeenCalled();
  });
});

describe('NotesService.setTags', () => {
  it('resolves the given tag ids and assigns them to the page', async () => {
    const page = Object.assign(new NotePage(), { id: 1, tags: [] });
    const notesRepository = {
      findByIdActive: jest.fn().mockResolvedValue(page),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    const tags = [{ id: 1, name: 'Urgent', color: 'red' }];
    const noteTagsRepository = { findByIds: jest.fn().mockResolvedValue(tags) };
    const service = makeService(notesRepository, noteTagsRepository);

    const result = await service.setTags(1, [1]);

    expect(noteTagsRepository.findByIds).toHaveBeenCalledWith([1]);
    expect(result.tags).toEqual([{ id: 1, name: 'Urgent', color: 'red' }]);
  });
});

describe('NotesService — private note ownership', () => {
  let service: NotesService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findByIdActive: jest.fn(),
      findById: jest.fn(),
      getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((page: NotePage) =>
        Promise.resolve(Object.assign(page, { id: page.id ?? 1 })),
      ),
      trashSubtree: jest.fn().mockResolvedValue(undefined),
    };
    service = makeService(notesRepository);
  });

  it('stamps the creator as owner on a new standalone note', async () => {
    await service.createNote({ title: 'Scratch' }, 5);

    const saved = notesRepository.save.mock.calls[0][0] as NotePage;
    expect(saved.ownerId).toBe(5);
  });

  it('lets the owner read their own private note', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: 5 }),
    );

    await expect(service.getNoteById(1, 5)).resolves.toMatchObject({ id: 1 });
  });

  it('hides another user\'s private note as 404, not the note\'s real content', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: 5 }),
    );

    await expect(service.getNoteById(1, 6)).rejects.toThrow(NoteNotFoundException);
  });

  it('blocks a non-owner from editing a private note', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: 5 }),
    );

    await expect(
      service.updateNote(1, { title: 'Hijacked' }, 6),
    ).rejects.toThrow(NoteNotFoundException);
  });

  it('blocks a non-owner from trashing a private note', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: 5 }),
    );

    await expect(service.trashNote(1, 6)).rejects.toThrow(NoteNotFoundException);
    expect(notesRepository.trashSubtree).not.toHaveBeenCalled();
  });

  it('never restricts a note linked to a CRM entity, regardless of owner', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: 'lead', ownerId: 5 }),
    );

    await expect(service.getNoteById(1, 999)).resolves.toMatchObject({ id: 1 });
  });

  it('never restricts a legacy note with no owner_id', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: null }),
    );

    await expect(service.getNoteById(1, 999)).resolves.toMatchObject({ id: 1 });
  });

  it('MCP (no userId) reads a private note that would otherwise be hidden', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: 5 }),
    );

    await expect(service.getNoteById(1)).resolves.toMatchObject({ id: 1 });
  });
});
