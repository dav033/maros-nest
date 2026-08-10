import { TaskNotificationsListener } from './task-notifications.listener';
import { Task } from '../../../entities/task.entity';

function task(overrides: Partial<Task> = {}): Task {
  return Object.assign(new Task(), { id: 1, title: 'Task', ...overrides });
}

function makeListener(
  overrides: {
    notificationsService?: Record<string, jest.Mock>;
    taskWatchersRepository?: Record<string, jest.Mock>;
    tasksRepository?: Record<string, jest.Mock>;
  } = {},
) {
  const notificationsService = {
    create: jest.fn().mockResolvedValue(undefined),
    ...overrides.notificationsService,
  };
  const taskWatchersRepository = {
    findUserIdsForTask: jest.fn().mockResolvedValue([]),
    ...overrides.taskWatchersRepository,
  };
  const tasksRepository = {
    findByIdActive: jest.fn().mockResolvedValue(task()),
    ...overrides.tasksRepository,
  };

  const listener = new TaskNotificationsListener(
    notificationsService as never,
    taskWatchersRepository as never,
    tasksRepository as never,
  );

  return { listener, notificationsService, taskWatchersRepository, tasksRepository };
}

describe('TaskNotificationsListener.onAssigned', () => {
  it('notifies the new assignee', async () => {
    const { listener, notificationsService } = makeListener();

    await listener.onAssigned({ taskId: 1, assigneeUserId: 7, actorId: 3 });

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, kind: 'task_assigned', actorId: 3 }),
    );
  });

  it('never notifies yourself for a self-assignment', async () => {
    const { listener, notificationsService } = makeListener();

    await listener.onAssigned({ taskId: 1, assigneeUserId: 3, actorId: 3 });

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('swallows errors instead of throwing', async () => {
    const { listener } = makeListener({
      tasksRepository: { findByIdActive: jest.fn().mockRejectedValue(new Error('db down')) },
    });

    await expect(
      listener.onAssigned({ taskId: 1, assigneeUserId: 7, actorId: 3 }),
    ).resolves.toBeUndefined();
  });
});

describe('TaskNotificationsListener watcher fanout', () => {
  it('notifies every watcher except the actor', async () => {
    const { listener, notificationsService, taskWatchersRepository } = makeListener({
      taskWatchersRepository: { findUserIdsForTask: jest.fn().mockResolvedValue([3, 7, 9]) },
    });

    await listener.onStatusChanged({ taskId: 1, actorId: 3, from: 'todo', to: 'in_progress' });

    expect(taskWatchersRepository.findUserIdsForTask).toHaveBeenCalledWith(1);
    expect(notificationsService.create).toHaveBeenCalledTimes(2);
    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 9 }));
    expect(notificationsService.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3 }),
    );
  });

  it('does nothing when the task no longer exists', async () => {
    const { listener, notificationsService } = makeListener({
      tasksRepository: { findByIdActive: jest.fn().mockResolvedValue(null) },
    });

    await listener.onBlocked({ taskId: 1, actorId: 3, reason: 'waiting on permit' });

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('notifies watchers on a new comment, with the comment id in the payload', async () => {
    const { listener, notificationsService } = makeListener({
      taskWatchersRepository: { findUserIdsForTask: jest.fn().mockResolvedValue([3, 7]) },
    });

    await listener.onCommented({ taskId: 1, commentId: 42, actorId: 3 });

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        kind: 'task_commented',
        payload: expect.objectContaining({ commentId: 42 }),
      }),
    );
  });
});
