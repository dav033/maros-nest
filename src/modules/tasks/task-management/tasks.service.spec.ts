import { TasksService } from './tasks.service';
import { TaskMapper } from './mappers/task.mapper';
import { TaskActivityService } from './services/task-activity.service';
import { Task } from '../../../entities/task.entity';
import type { TaskActor } from './services/task-actor';
import {
  TaskNotFoundException,
  TaskConflictException,
  TaskSubtaskNestingException,
  TaskNotASubtaskException,
  TaskBlockedReasonRequiredException,
} from '../../../common/exceptions';

function actor(id = 1, canDelete = false): TaskActor {
  return { id, canDelete };
}

function task(overrides: Partial<Task> = {}): Task {
  return Object.assign(new Task(), {
    id: 1,
    title: 'Task',
    description: {},
    kind: 'general',
    status: 'todo',
    priority: 'normal',
    position: 1000,
    parent: null,
    blockedReason: null,
    completedAt: null,
    attachments: [],
    labels: [],
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

/**
 * Real TaskActivityService and TaskMapper, not stubs — these tests are largely about
 * whether the right activity gets logged, and a mock that always resolves would pass no
 * matter what TasksService actually recorded. Only the repository layer is mocked, same
 * approach as notes.service.spec.ts.
 */
function makeService(
  tasksRepositoryOverrides: Record<string, jest.Mock> = {},
  taskLabelsRepositoryOverrides: Record<string, jest.Mock> = {},
) {
  const tasksRepository: Record<string, jest.Mock> = {
    findChildren: jest.fn().mockResolvedValue([]),
    getMaxPositionInColumn: jest.fn().mockResolvedValue(0),
    getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
    // Entering 'done' always checks for open subtasks; 0 keeps tests that aren't about
    // that warning from having to mock it individually.
    countOpenChildren: jest.fn().mockResolvedValue(0),
    // getBoard() always calls this alongside findForBoard() — 0 keeps tests that
    // aren't about the done-column window from having to mock it individually.
    countDone: jest.fn().mockResolvedValue(0),
    ...tasksRepositoryOverrides,
  };

  const taskLabelsRepository = { findByIds: jest.fn().mockResolvedValue([]), ...taskLabelsRepositoryOverrides };
  const taskWatchersRepository = {
    addMany: jest.fn().mockResolvedValue(undefined),
    findUserIdsForTask: jest.fn().mockResolvedValue([]),
  };
  const taskActivityRepository = {
    log: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  };
  // freshDetail() splices this in alongside children/activity — see TasksService.
  const taskComments = { list: jest.fn().mockResolvedValue([]) };
  const eventEmitter = { emit: jest.fn() };
  // No task here links to a CRM entity by default — tests that care about the
  // resolved link cover TaskEntityResolverService directly.
  const taskEntityResolver = {
    resolveMany: jest.fn().mockResolvedValue(new Map()),
    canonicalizeTaskLink: jest.fn().mockImplementation(async (link: unknown) => link),
  };

  const service = new TasksService(
    tasksRepository as never,
    taskLabelsRepository as never,
    taskWatchersRepository as never,
    new TaskActivityService(taskActivityRepository as never),
    taskComments as never,
    new TaskMapper(),
    taskEntityResolver as never,
    eventEmitter as never,
  );

  return {
    service,
    tasksRepository,
    taskWatchersRepository,
    taskActivityRepository,
    taskEntityResolver,
    eventEmitter,
  };
}

describe('TasksService.create', () => {
  it('creates a top-level task at the first position step', async () => {
    let saved: Task | null = null;
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = Object.assign(t, { id: 1 });
        return Promise.resolve(saved);
      }),
    });

    const result = await service.create({ title: 'Pour foundation' }, actor(3));

    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.position).toBe(1000);
    expect(savedTask.status).toBe('todo');
    expect(savedTask.reporterId).toBe(3);
    expect(result.title).toBe('Pour foundation');
  });

  it('rejects a parentId that does not resolve to an active task', async () => {
    const { service } = makeService({ findByIdActive: jest.fn().mockResolvedValue(null) });

    await expect(
      service.create({ title: 'Orphan', parentId: 999 }, actor()),
    ).rejects.toThrow(TaskNotFoundException);
  });

  it('rejects nesting a subtask under a task that is itself a subtask', async () => {
    const grandparent = task({ id: 1 });
    const parent = task({ id: 2, parent: grandparent });
    const { service } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(parent),
    });

    await expect(
      service.create({ title: 'Too deep', parentId: 2 }, actor()),
    ).rejects.toThrow(TaskSubtaskNestingException);
  });

  it('seeds watchers with the creator, reporter and assignee', async () => {
    let saved: Task | null = null;
    const { service, taskWatchersRepository } = makeService({
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = Object.assign(t, { id: 1 });
        return Promise.resolve(saved);
      }),
    });

    await service.create({ title: 'New', assigneeUserId: 7 }, actor(3));

    // reporterId defaults to actor.id (3) when the dto doesn't set one; the repository
    // is the one that dedupes, so the raw call still carries the duplicate.
    expect(taskWatchersRepository.addMany).toHaveBeenCalledWith(1, [3, 3, 7]);
  });

  it('emits task.assigned when created with an assignee already set', async () => {
    let saved: Task | null = null;
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = Object.assign(t, { id: 1 });
        return Promise.resolve(saved);
      }),
    });

    await service.create({ title: 'New', assigneeUserId: 7 }, actor(3));

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'task.assigned',
      expect.objectContaining({ taskId: 1, assigneeUserId: 7, actorId: 3 }),
    );
  });

  it('logs a created activity entry', async () => {
    let saved: Task | null = null;
    const { service, taskActivityRepository } = makeService({
      findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = Object.assign(t, { id: 1 });
        return Promise.resolve(saved);
      }),
    });

    await service.create({ title: 'New' }, actor(3));

    expect(taskActivityRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, actorId: 3, kind: 'created' }),
    );
  });
});

describe('TasksService.move', () => {
  it('stamps completedAt when entering done', async () => {
    const existing = task({ status: 'in_progress', completedAt: null });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'done' }, actor());

    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.completedAt).toBeInstanceOf(Date);
  });

  it('clears completedAt when leaving done', async () => {
    const existing = task({ status: 'done', completedAt: new Date('2026-01-01') });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'todo' }, actor());

    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.completedAt).toBeNull();
  });

  it('rejects moving to blocked with no reason available', async () => {
    const existing = task({ status: 'todo', blockedReason: null });
    const { service } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
    });

    await expect(service.move(1, { status: 'blocked' }, actor())).rejects.toThrow(
      TaskBlockedReasonRequiredException,
    );
  });

  it('accepts moving to blocked when a reason is provided in the same call', async () => {
    const existing = task({ status: 'todo', blockedReason: null });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'blocked', blockedReason: 'Waiting on permit' }, actor());

    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.blockedReason).toBe('Waiting on permit');
  });

  it('clears blockedReason on leaving blocked', async () => {
    const existing = task({ status: 'blocked', blockedReason: 'Waiting on permit' });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'todo' }, actor());

    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.blockedReason).toBeNull();
  });

  it('appends after the last sibling in the target column by default', async () => {
    const existing = task({ status: 'todo' });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([{ id: 2, position: 1000 }]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'in_progress' }, actor());

    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.position).toBe(2000);
  });

  it('rebalances and retries when the sibling gap has collapsed', async () => {
    const existing = task({ status: 'todo' });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 2, position: 1000 },
          { id: 3, position: 1001 },
        ])
        .mockResolvedValueOnce([
          { id: 2, position: 1000 },
          { id: 3, position: 2000 },
        ]),
      rebalanceSiblings: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'todo', afterId: 2 }, actor());

    expect(tasksRepository.rebalanceSiblings).toHaveBeenCalledWith([2, 3], 1000);
    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.position).toBe(1500);
  });

  it('leaves a subtask position untouched — reordering one is reorderSubtask, not move', async () => {
    const parent = task({ id: 2 });
    const existing = task({ id: 1, parent, status: 'todo', position: 1000 });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn(),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'done' }, actor());

    expect(tasksRepository.getSiblingsInColumn).not.toHaveBeenCalled();
    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.position).toBe(1000);
  });

  it('logs a status_changed activity entry and emits the event', async () => {
    const existing = task({ status: 'todo' });
    const { service, taskActivityRepository, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'in_progress' }, actor(9));

    expect(taskActivityRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        actorId: 9,
        kind: 'status_changed',
        fromValue: 'todo',
        toValue: 'in_progress',
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'task.status_changed',
      expect.objectContaining({ taskId: 1, from: 'todo', to: 'in_progress' }),
    );
  });

  it('warns but does not block closing a top-level task with open subtasks', async () => {
    const existing = task({ status: 'in_progress' });
    const { service } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      countOpenChildren: jest.fn().mockResolvedValue(2),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    const result = await service.move(1, { status: 'done' }, actor());

    expect(result.openSubtasksWarning).toBe(2);
  });

  it('emits task.changed even for a same-column reorder — the most common drag, and the one that changes no status', async () => {
    const existing = task({ status: 'todo' });
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsInColumn: jest.fn().mockResolvedValue([{ id: 2, position: 1000 }]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.move(1, { status: 'todo', afterId: 2 }, actor(7));

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.changed', { taskId: 1, actorId: 7 });
    // No status transition — the narrower event must not fire.
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('task.status_changed', expect.anything());
  });
});

describe('TasksService.reorderSubtask', () => {
  it('positions a subtask between two of its siblings', async () => {
    const parent = task({ id: 10 });
    const existing = task({ id: 1, parent, position: 5000 });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsUnderParent: jest.fn().mockResolvedValue([
        { id: 2, position: 1000 },
        { id: 3, position: 2000 },
      ]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.reorderSubtask(1, { afterId: 2 }, actor());

    expect(tasksRepository.getSiblingsUnderParent).toHaveBeenCalledWith(10, 1);
    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.position).toBe(1500);
  });

  it('rebalances the parent when the gap between siblings is exhausted', async () => {
    const parent = task({ id: 10 });
    const existing = task({ id: 1, parent });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsUnderParent: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 2, position: 1000 },
          { id: 3, position: 1001 },
        ])
        .mockResolvedValueOnce([
          { id: 2, position: 1000 },
          { id: 3, position: 2000 },
        ]),
      rebalanceSiblings: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.reorderSubtask(1, { afterId: 2 }, actor());

    expect(tasksRepository.rebalanceSiblings).toHaveBeenCalledWith([2, 3], 1000);
    const savedTask = (tasksRepository.save.mock.calls[0] as [Task])[0];
    expect(savedTask.position).toBe(1500);
  });

  it('refuses to reorder a top-level task, which belongs to a board column instead', async () => {
    const existing = task({ id: 1, parent: null });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn(),
    });

    await expect(service.reorderSubtask(1, { afterId: 2 }, actor())).rejects.toThrow(
      TaskNotASubtaskException,
    );
    expect(tasksRepository.save).not.toHaveBeenCalled();
  });

  it('broadcasts the change so other viewers pick up the new order', async () => {
    const parent = task({ id: 10 });
    const existing = task({ id: 1, parent });
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      getSiblingsUnderParent: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.reorderSubtask(1, {}, actor(7));

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.changed', {
      taskId: 1,
      actorId: 7,
    });
  });
});

describe('TasksService.findAll', () => {
  it('maps items and passes totalCount through untouched from the repository', async () => {
    const tasks = [task({ id: 1 }), task({ id: 2 })];
    const { service } = makeService({
      findAll: jest.fn().mockResolvedValue({ items: tasks, totalCount: 137 }),
      countSubtasksByParents: jest.fn().mockResolvedValue(new Map()),
      countCommentsByTasks: jest.fn().mockResolvedValue(new Map()),
    });

    const result = await service.findAll({});

    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(137);
  });
});

describe('TasksService.getBoard', () => {
  it('attaches subtask and comment counts looked up per task id', async () => {
    const tasks = [task({ id: 1, status: 'todo' }), task({ id: 2, status: 'in_progress' })];
    const { service } = makeService({
      findForBoard: jest.fn().mockResolvedValue(tasks),
      countSubtasksByParents: jest.fn().mockResolvedValue(
        new Map([[1, { total: 3, done: 1 }]]),
      ),
      countCommentsByTasks: jest.fn().mockResolvedValue(new Map([[2, 4]])),
    });

    const board = await service.getBoard();

    expect(board.columns.todo[0]).toMatchObject({ subtasksTotal: 3, subtasksDone: 1, commentsCount: 0 });
    expect(board.columns.in_progress[0]).toMatchObject({ subtasksTotal: 0, subtasksDone: 0, commentsCount: 4 });
  });

  it('attaches the resolved CRM link, looked up in one batched call across the board', async () => {
    const tasks = [
      task({ id: 1, status: 'todo', entityKind: 'lead', entityId: 42 }),
      task({ id: 2, status: 'in_progress' }),
    ];
    const resolved = {
      kind: 'lead' as const,
      id: 42,
      label: 'Kitchen remodel',
      href: '/lead/42',
    };
    const { service, taskEntityResolver } = makeService({
      findForBoard: jest.fn().mockResolvedValue(tasks),
      countSubtasksByParents: jest.fn().mockResolvedValue(new Map()),
      countCommentsByTasks: jest.fn().mockResolvedValue(new Map()),
    });
    taskEntityResolver.resolveMany.mockResolvedValue(new Map([['lead:42', resolved]]));

    const board = await service.getBoard();

    expect(taskEntityResolver.resolveMany).toHaveBeenCalledWith([{ entityKind: 'lead', entityId: 42 }]);
    expect(board.columns.todo[0].entity).toEqual(resolved);
    expect(board.columns.in_progress[0].entity).toBeNull();
  });

  it('reports the true done count separately from the windowed done column', async () => {
    const tasks = [task({ id: 1, status: 'done' })];
    const { service } = makeService({
      findForBoard: jest.fn().mockResolvedValue(tasks),
      countDone: jest.fn().mockResolvedValue(137),
      countSubtasksByParents: jest.fn().mockResolvedValue(new Map()),
      countCommentsByTasks: jest.fn().mockResolvedValue(new Map()),
    });

    const board = await service.getBoard();

    // findForBoard already applied the window — the service trusts it, and only
    // reports the true total alongside it, rather than recomputing anything.
    expect(board.columns.done).toHaveLength(1);
    expect(board.doneTotalCount).toBe(137);
  });
});

describe('TasksService.setAssignee', () => {
  it('adds the new assignee as a watcher and emits task.assigned', async () => {
    const existing = task({ assigneeUserId: null });
    const { service, taskWatchersRepository, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.setAssignee(1, { userId: 7 }, actor(3));

    expect(taskWatchersRepository.addMany).toHaveBeenCalledWith(1, [7]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'task.assigned',
      expect.objectContaining({ taskId: 1, assigneeUserId: 7, actorId: 3 }),
    );
  });

  it('does not emit task.assigned when unassigning', async () => {
    const existing = task({ assigneeUserId: 7 });
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.setAssignee(1, { userId: null }, actor(3));

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('task.assigned', expect.anything());
  });
});

describe('TasksService.update — optimistic concurrency', () => {
  it('rejects a stale expectedUpdatedAt with a conflict, before touching any field', async () => {
    const existing = task({ title: 'Original', updatedAt: new Date('2026-01-01T00:00:00.000Z') });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await expect(
      service.update(
        1,
        { title: 'Someone else already renamed this', expectedUpdatedAt: '2025-12-31T00:00:00.000Z' },
        actor(4),
      ),
    ).rejects.toThrow(TaskConflictException);

    expect(existing.title).toBe('Original');
    expect(tasksRepository.save).not.toHaveBeenCalled();
  });

  it('accepts the write when expectedUpdatedAt matches the row', async () => {
    const existing = task({ title: 'Original', updatedAt: new Date('2026-01-01T00:00:00.000Z') });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.update(
      1,
      { title: 'Renamed', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
      actor(4),
    );

    expect(tasksRepository.save).toHaveBeenCalled();
  });

  it('skips the check entirely when the caller sends no expectedUpdatedAt', async () => {
    // The board drag and the one-tap status button never send it — last write wins
    // there by design (see UpdateTaskDto).
    const existing = task({ title: 'Original', updatedAt: new Date('2026-01-01T00:00:00.000Z') });
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.update(1, { title: 'Renamed without a version check' }, actor(4));

    expect(tasksRepository.save).toHaveBeenCalled();
  });
});

describe('TasksService — task.changed broadcast', () => {
  it('emits on update()', async () => {
    const existing = task();
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.update(1, { title: 'Renamed' }, actor(9));

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.changed', { taskId: 1, actorId: 9 });
  });

  it('emits on setEntityLink()', async () => {
    const existing = task();
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.setEntityLink(1, { entityKind: 'lead', entityId: 42 }, actor(9));

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.changed', { taskId: 1, actorId: 9 });
  });

  it('emits on setLabels()', async () => {
    const existing = task();
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.setLabels(1, { labelIds: [] }, actor(9));

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.changed', { taskId: 1, actorId: 9 });
  });

  it('emits on delete()', async () => {
    const existing = task();
    const { service, eventEmitter } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      softDeleteWithChildren: jest.fn().mockResolvedValue(undefined),
    });

    await service.delete(1, actor(9));

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.changed', { taskId: 1, actorId: 9 });
  });
});

describe('TasksService.addAttachments', () => {
  it('unions new keys onto whatever the server currently holds, not the caller\'s copy', async () => {
    // The server already gained 'b.png' from a concurrent upload the caller doesn't
    // know about — addAttachments must never require (or accept) the full list, so
    // that upload can't be lost.
    const existing = task({ attachments: ['a.png', 'b.png'] });
    let saved: Task | null = null;
    const { service, taskActivityRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = t;
        return Promise.resolve(t);
      }),
    });

    await service.addAttachments(1, ['c.png'], actor(4));

    expect((saved as Task | null)?.attachments).toEqual(['a.png', 'b.png', 'c.png']);
    expect(taskActivityRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, actorId: 4, kind: 'attachment_added', toValue: '1' }),
    );
  });

  it('ignores keys already present and logs nothing when nothing new was added', async () => {
    const existing = task({ attachments: ['a.png'] });
    const { service, tasksRepository, taskActivityRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.addAttachments(1, ['a.png'], actor(4));

    expect(tasksRepository.save).not.toHaveBeenCalled();
    expect(taskActivityRepository.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'attachment_added' }),
    );
  });
});

describe('TasksService.removeAttachment', () => {
  it('removes only the given key, against the server\'s current set', async () => {
    const existing = task({ attachments: ['a.png', 'b.png', 'c.png'] });
    let saved: Task | null = null;
    const { service } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = t;
        return Promise.resolve(t);
      }),
    });

    await service.removeAttachment(1, 'b.png', actor());

    expect((saved as Task | null)?.attachments).toEqual(['a.png', 'c.png']);
  });
});

describe('TasksService.reorderAttachments', () => {
  it('applies the requested order for keys the server still has', async () => {
    const existing = task({ attachments: ['a.png', 'b.png', 'c.png'] });
    let saved: Task | null = null;
    const { service } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = t;
        return Promise.resolve(t);
      }),
    });

    await service.reorderAttachments(1, ['c.png', 'a.png', 'b.png'], actor());

    expect((saved as Task | null)?.attachments).toEqual(['c.png', 'a.png', 'b.png']);
  });

  it('drops keys the server no longer has and appends keys the caller did not know about', async () => {
    // Caller's reorder was computed before a concurrent add ('d.png') and a concurrent
    // remove ('b.png') landed on the server.
    const existing = task({ attachments: ['a.png', 'c.png', 'd.png'] });
    let saved: Task | null = null;
    const { service } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => {
        saved = t;
        return Promise.resolve(t);
      }),
    });

    await service.reorderAttachments(1, ['c.png', 'b.png', 'a.png'], actor());

    expect((saved as Task | null)?.attachments).toEqual(['c.png', 'a.png', 'd.png']);
  });
});

describe('TasksService.addLabelsToTask', () => {
  it('unions new labels onto whatever the task already has, without duplicating', async () => {
    const urgent = { id: 1, name: 'urgent', color: 'red' };
    const existingLabel = { id: 2, name: 'permit', color: 'blue' };
    const existing = task({ labels: [existingLabel] as never });
    let saved: Task | null = null;
    const { service } = makeService(
      {
        findByIdActive: jest.fn().mockResolvedValue(existing),
        save: jest.fn().mockImplementation((t: Task) => {
          saved = t;
          return Promise.resolve(t);
        }),
      },
      { findByIds: jest.fn().mockResolvedValue([urgent, existingLabel]) },
    );

    await service.addLabelsToTask(1, [1, 2], actor(4));

    // 'permit' (id 2) was already there — the union doesn't duplicate it.
    expect((saved as Task | null)?.labels).toEqual([existingLabel, urgent]);
  });
});

describe('TasksService bulk actions', () => {
  it('bulkSetAssignee assigns every task and reports them all succeeded', async () => {
    const { service, tasksRepository } = makeService({
      // A distinct object per id — sharing one fixture across ids would let the
      // second call see the first call's already-applied assigneeUserId and
      // short-circuit as a no-op (setAssignee skips saving when nothing changed).
      findByIdActive: jest.fn().mockImplementation((id: number) =>
        Promise.resolve(task({ id, assigneeUserId: null })),
      ),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    const result = await service.bulkSetAssignee([1, 2, 3], 9, actor(4));

    expect(result.succeeded).toEqual([1, 2, 3]);
    expect(result.failed).toEqual([]);
    expect(tasksRepository.save).toHaveBeenCalledTimes(3);
  });

  it('isolates a per-task failure — the rest of the batch still succeeds', async () => {
    const { service } = makeService({
      findByIdActive: jest.fn().mockImplementation((id: number) =>
        Promise.resolve(id === 2 ? null : task({ id })),
      ),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    const result = await service.bulkSetAssignee([1, 2, 3], 9, actor(4));

    expect(result.succeeded).toEqual([1, 3]);
    expect(result.failed).toEqual([{ taskId: 2, error: 'Task not found with id: 2' }]);
  });

  it('bulkSetStatus moves every task to the target status', async () => {
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockImplementation((id: number) => Promise.resolve(task({ id, status: 'todo' }))),
      getSiblingsInColumn: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    const result = await service.bulkSetStatus([1, 2], 'in_progress', undefined, actor(4));

    expect(result.succeeded).toEqual([1, 2]);
    expect(tasksRepository.save).toHaveBeenCalledTimes(2);
  });

  it('bulkDelete soft-deletes every task', async () => {
    const { service, tasksRepository } = makeService({
      findByIdActive: jest.fn().mockImplementation((id: number) => Promise.resolve(task({ id }))),
      softDeleteWithChildren: jest.fn().mockResolvedValue(undefined),
    });

    const result = await service.bulkDelete([1, 2, 3], actor(4));

    expect(result.succeeded).toEqual([1, 2, 3]);
    expect(tasksRepository.softDeleteWithChildren).toHaveBeenCalledTimes(3);
  });
});
