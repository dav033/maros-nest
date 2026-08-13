import { ForbiddenException } from '@nestjs/common';
import { TaskCommentsService } from './task-comments.service';
import { TaskActivityService } from './task-activity.service';
import { TaskComment } from '../../../../entities/task-comment.entity';
import { Task } from '../../../../entities/task.entity';
import type { TaskActor } from './task-actor';
import { TaskNotFoundException, TaskCommentNotFoundException } from '../../../../common/exceptions';

function actor(id = 1, canDelete = false): TaskActor {
  return { id, canDelete };
}

function comment(overrides: Partial<TaskComment> = {}): TaskComment {
  return Object.assign(new TaskComment(), {
    id: 1,
    taskId: 10,
    authorId: 1,
    body: {},
    ...overrides,
  });
}

function bodyMentioning(...userIds: number[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: userIds.map((id) => ({ type: 'mention', attrs: { id: String(id) } })),
      },
    ],
  };
}

function makeService(
  overrides: {
    taskCommentsRepository?: Record<string, jest.Mock>;
    tasksRepository?: Record<string, jest.Mock>;
  } = {},
) {
  const taskCommentsRepository = {
    findByTask: jest.fn().mockResolvedValue([]),
    findByIdActive: jest.fn(),
    save: jest.fn().mockImplementation((c: TaskComment) => Promise.resolve(c)),
    softDelete: jest.fn().mockResolvedValue(undefined),
    ...overrides.taskCommentsRepository,
  };
  const tasksRepository = {
    findByIdActive: jest.fn().mockResolvedValue(Object.assign(new Task(), { id: 10 })),
    ...overrides.tasksRepository,
  };
  const taskWatchersRepository = { addMany: jest.fn().mockResolvedValue(undefined) };
  const taskActivityRepository = {
    log: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  };
  const eventEmitter = { emit: jest.fn() };

  const service = new TaskCommentsService(
    taskCommentsRepository as never,
    tasksRepository as never,
    taskWatchersRepository as never,
    new TaskActivityService(taskActivityRepository as never),
    eventEmitter as never,
  );

  return {
    service,
    taskCommentsRepository,
    tasksRepository,
    taskWatchersRepository,
    taskActivityRepository,
    eventEmitter,
  };
}

describe('TaskCommentsService.create', () => {
  it('rejects when the task does not exist', async () => {
    const { service } = makeService({
      tasksRepository: { findByIdActive: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.create(10, { body: {} }, actor())).rejects.toThrow(TaskNotFoundException);
  });

  it('adds the author as a watcher and logs a commented activity', async () => {
    let saved: TaskComment | null = null;
    const { service, taskWatchersRepository, taskActivityRepository } = makeService({
      taskCommentsRepository: {
        save: jest.fn().mockImplementation((c: TaskComment) => {
          saved = Object.assign(c, { id: 5 });
          return Promise.resolve(saved);
        }),
        findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      },
    });

    await service.create(10, { body: {} }, actor(3));

    expect(taskWatchersRepository.addMany).toHaveBeenCalledWith(10, [3]);
    expect(taskActivityRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 10, actorId: 3, kind: 'commented' }),
    );
  });

  it('emits task.commented', async () => {
    let saved: TaskComment | null = null;
    const { service, eventEmitter } = makeService({
      taskCommentsRepository: {
        save: jest.fn().mockImplementation((c: TaskComment) => {
          saved = Object.assign(c, { id: 5 });
          return Promise.resolve(saved);
        }),
        findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      },
    });

    await service.create(10, { body: {} }, actor(3));

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'task.commented',
      expect.objectContaining({ taskId: 10, commentId: 5, actorId: 3 }),
    );
  });

  it('adds a mentioned user as a watcher and emits task.mentioned', async () => {
    let saved: TaskComment | null = null;
    const { service, taskWatchersRepository, eventEmitter } = makeService({
      taskCommentsRepository: {
        save: jest.fn().mockImplementation((c: TaskComment) => {
          saved = Object.assign(c, { id: 5 });
          return Promise.resolve(saved);
        }),
        findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      },
    });

    await service.create(10, { body: bodyMentioning(7) }, actor(3));

    expect(taskWatchersRepository.addMany).toHaveBeenCalledWith(10, [7]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'task.mentioned',
      expect.objectContaining({ taskId: 10, commentId: 5, actorId: 3, mentionedUserId: 7 }),
    );
  });

  it('does not notify a self-mention', async () => {
    let saved: TaskComment | null = null;
    const { service, eventEmitter } = makeService({
      taskCommentsRepository: {
        save: jest.fn().mockImplementation((c: TaskComment) => {
          saved = Object.assign(c, { id: 5 });
          return Promise.resolve(saved);
        }),
        findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      },
    });

    await service.create(10, { body: bodyMentioning(3) }, actor(3));

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('task.mentioned', expect.anything());
  });

  it('mentioning nobody emits no task.mentioned event', async () => {
    let saved: TaskComment | null = null;
    const { service, eventEmitter } = makeService({
      taskCommentsRepository: {
        save: jest.fn().mockImplementation((c: TaskComment) => {
          saved = Object.assign(c, { id: 5 });
          return Promise.resolve(saved);
        }),
        findByIdActive: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      },
    });

    await service.create(10, { body: {} }, actor(3));

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('task.mentioned', expect.anything());
  });
});

describe('TaskCommentsService authorship', () => {
  it('lets the author update their own comment', async () => {
    const existing = comment({ authorId: 3 });
    const { service } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await expect(service.update(10, 1, { body: { x: 1 } }, actor(3))).resolves.toBeDefined();
  });

  it('notifies a mention newly added in an edit', async () => {
    const existing = comment({ authorId: 3, taskId: 10, body: {} });
    const { service, taskWatchersRepository, eventEmitter } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await service.update(10, 1, { body: bodyMentioning(9) }, actor(3));

    expect(taskWatchersRepository.addMany).toHaveBeenCalledWith(10, [9]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'task.mentioned',
      expect.objectContaining({ taskId: 10, commentId: 1, actorId: 3, mentionedUserId: 9 }),
    );
  });

  it('skips mention processing entirely when the edit does not touch the body', async () => {
    const existing = comment({ authorId: 3 });
    const { service, eventEmitter } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await service.update(10, 1, {}, actor(3));

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('task.mentioned', expect.anything());
  });

  it('rejects a non-author without tasks:delete', async () => {
    const existing = comment({ authorId: 3 });
    const { service } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await expect(service.update(10, 1, { body: {} }, actor(9, false))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets someone with tasks:delete edit any comment', async () => {
    const existing = comment({ authorId: 3 });
    const { service } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await expect(service.update(10, 1, { body: {} }, actor(9, true))).resolves.toBeDefined();
  });

  it('throws TaskCommentNotFoundException for a comment that belongs to a different task', async () => {
    const existing = comment({ taskId: 999 });
    const { service } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await expect(service.update(10, 1, { body: {} }, actor(3))).rejects.toThrow(
      TaskCommentNotFoundException,
    );
  });

  it('soft-deletes when authorized', async () => {
    const existing = comment({ authorId: 3 });
    const { service, taskCommentsRepository } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await service.delete(10, 1, actor(3));

    expect(taskCommentsRepository.softDelete).toHaveBeenCalledWith(1);
  });

  it('rejects deleting someone else’s comment without tasks:delete', async () => {
    const existing = comment({ authorId: 3 });
    const { service } = makeService({
      taskCommentsRepository: { findByIdActive: jest.fn().mockResolvedValue(existing) },
    });

    await expect(service.delete(10, 1, actor(9, false))).rejects.toThrow(ForbiddenException);
  });
});
