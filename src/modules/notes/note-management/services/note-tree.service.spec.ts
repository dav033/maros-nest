import { NoteTreeService } from './note-tree.service';
import { NotePage } from '../../../../entities/note-page.entity';
import { NoteCycleException, NoteNotFoundException } from '../../../../common/exceptions';

describe('NoteTreeService.assertNoCycle', () => {
  let service: NoteTreeService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = { getActiveParentMap: jest.fn() };
    service = new NoteTreeService(notesRepository as never);
  });

  it('throws when the target parent is the page itself', async () => {
    notesRepository.getActiveParentMap.mockResolvedValue([]);
    await expect(service.assertNoCycle(1, 1)).rejects.toThrow(NoteCycleException);
  });

  it('throws when the target parent is a descendant of the page', async () => {
    // tree: 1 -> 2 -> 3 (moving 1 under 3 would create a cycle)
    notesRepository.getActiveParentMap.mockResolvedValue([
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
    ]);
    await expect(service.assertNoCycle(1, 3)).rejects.toThrow(NoteCycleException);
  });

  it('allows moving under an unrelated page', async () => {
    notesRepository.getActiveParentMap.mockResolvedValue([
      { id: 2, parentId: 1 },
      { id: 5, parentId: null },
    ]);
    await expect(service.assertNoCycle(1, 5)).resolves.toBeUndefined();
  });
});

describe('NoteTreeService.move', () => {
  let service: NoteTreeService;
  let notesRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    notesRepository = {
      findByIdActive: jest.fn(),
      getActiveParentMap: jest.fn().mockResolvedValue([]),
      getSiblings: jest.fn(),
      rebalanceSiblings: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation((p: NotePage) => Promise.resolve(p)),
    };
    service = new NoteTreeService(notesRepository as never);
  });

  it('throws NoteNotFoundException when the page does not exist', async () => {
    notesRepository.findByIdActive.mockResolvedValue(null);
    await expect(service.move(1, null)).rejects.toThrow(NoteNotFoundException);
  });

  it('throws NoteNotFoundException when the target parent does not exist', async () => {
    notesRepository.findByIdActive
      .mockResolvedValueOnce(Object.assign(new NotePage(), { id: 1 })) // the page
      .mockResolvedValueOnce(null); // the parent
    await expect(service.move(1, 99)).rejects.toThrow(NoteNotFoundException);
  });

  it('moves to root and appends after the last sibling by default', async () => {
    notesRepository.findByIdActive.mockResolvedValue(
      Object.assign(new NotePage(), { id: 1 }),
    );
    notesRepository.getSiblings.mockResolvedValue([{ id: 2, position: 1000 }]);

    const result = await service.move(1, null);

    expect(result).toEqual({ id: 1, parentId: null, position: 2000 });
  });

  it('rebalances and retries when the sibling gap has collapsed', async () => {
    const page = Object.assign(new NotePage(), { id: 1 });
    notesRepository.findByIdActive.mockResolvedValue(page);
    notesRepository.getSiblings
      .mockResolvedValueOnce([
        { id: 2, position: 1000 },
        { id: 3, position: 1001 },
      ])
      .mockResolvedValueOnce([
        { id: 2, position: 1000 },
        { id: 3, position: 2000 },
      ]);

    const result = await service.move(1, null, undefined, 2);

    expect(notesRepository.rebalanceSiblings).toHaveBeenCalledWith([2, 3], 1000);
    expect(result.position).toBe(1500);
  });
});
