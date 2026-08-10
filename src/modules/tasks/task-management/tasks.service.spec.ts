import { TasksService } from './tasks.service';
import { TaskMapper } from './mappers/task.mapper';
import { TaskActivityService } from './services/task-activity.service';
import { Task } from '../../../entities/task.entity';
import type { TaskActor } from './services/task-actor';
import {
  TaskNotFoundException,
  TaskSubtaskNestingException,
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
    ...overrides,
  });
}

/**
 * Real TaskActivityService and TaskMapper, not stubs — these tests are largely about
 * whether the right activity gets logged, and a mock that always resolves would pass no
 * matter what TasksService actually recorded. Only the repository layer is mocked, same
 * approach as notes.service.spec.ts.
 */
function makeService(tasksRepositoryOverrides: Record<string, jest.Mock> = {}) {
  const tasksRepository = {
    findChildren: jest.fn().mockResolvedValue([]),
    getMaxPositionInColumn: jest.fn().mockResolvedValue(0),
    getMaxPositionUnderParent: jest.fn().mockResolvedValue(0),
    // Entering 'done' always checks for open subtasks; 0 keeps tests that aren't about
    // that warning from having to mock it individually.
    countOpenChildren: jest.fn().mockResolvedValue(0),
    ...tasksRepositoryOverrides,
  };

  const taskLabelsRepository = { findByIds: jest.fn().mockResolvedValue([]) };
  const taskWatchersRepository = { addMany: jest.fn().mockResolvedValue(undefined) };
  const taskActivityRepository = {
    log: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  };
  // freshDetail() splices this in alongside children/activity — see TasksService.
  const taskComments = { list: jest.fn().mockResolvedValue([]) };
  const eventEmitter = { emit: jest.fn() };

  const service = new TasksService(
    tasksRepository as never,
    taskLabelsRepository as never,
    taskWatchersRepository as never,
    new TaskActivityService(taskActivityRepository as never),
    taskComments as never,
    new TaskMapper(),
    eventEmitter as never,
  );

  return { service, tasksRepository, taskWatchersRepository, taskActivityRepository, eventEmitter };
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

  it('leaves a subtask position untouched — no reordering endpoint exists for it yet', async () => {
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

describe('TasksService.update', () => {
  it('logs attachment_added when the attachment list grows', async () => {
    const existing = task({ attachments: ['a.png'] });
    const { service, taskActivityRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.update(1, { attachments: ['a.png', 'b.png', 'c.png'] }, actor(4));

    expect(taskActivityRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, actorId: 4, kind: 'attachment_added', toValue: '2' }),
    );
  });

  it('does not log an activity when attachments only shrink or reorder', async () => {
    const existing = task({ attachments: ['a.png', 'b.png'] });
    const { service, taskActivityRepository } = makeService({
      findByIdActive: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
    });

    await service.update(1, { attachments: ['b.png'] }, actor(4));

    expect(taskActivityRepository.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'attachment_added' }),
    );
  });
});
