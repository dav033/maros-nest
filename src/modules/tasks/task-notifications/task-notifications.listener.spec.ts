import { TaskNotificationsListener } from './task-notifications.listener';
import { Task } from '../../../entities/task.entity';
import { User } from '../../../entities/user.entity';

function task(overrides: Partial<Task> = {}): Task {
  return Object.assign(new Task(), { id: 1, title: 'Task', ...overrides });
}

function user(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), { id: 7, email: 'crew@marosconstruction.com', ...overrides });
}

function makeListener(
  overrides: {
    notificationsService?: Record<string, jest.Mock>;
    taskWatchersRepository?: Record<string, jest.Mock>;
    tasksRepository?: Record<string, jest.Mock>;
    usersRepository?: Record<string, jest.Mock>;
    mailService?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
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
  const usersRepository = {
    findById: jest.fn().mockResolvedValue(user()),
    ...overrides.usersRepository,
  };
  const mailService = {
    sendMail: jest.fn().mockResolvedValue({ sent: true, messageId: 'abc123' }),
    ...overrides.mailService,
  };
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
    ...overrides.configService,
  };

  const listener = new TaskNotificationsListener(
    notificationsService as never,
    taskWatchersRepository as never,
    tasksRepository as never,
    usersRepository as never,
    mailService as never,
    configService as never,
  );

  return {
    listener,
    notificationsService,
    taskWatchersRepository,
    tasksRepository,
    usersRepository,
    mailService,
    configService,
  };
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

describe('TaskNotificationsListener assignment email', () => {
  it('emails the new assignee, with both a text and an HTML body', async () => {
    const { listener, mailService, usersRepository } = makeListener();

    await listener.onAssigned({ taskId: 1, assigneeUserId: 7, actorId: 3 });

    expect(usersRepository.findById).toHaveBeenCalledWith(7);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['crew@marosconstruction.com'],
        text: expect.stringContaining('Task'),
        html: expect.stringContaining('<html'),
      }),
    );
  });

  it('still emails on a self-assignment, even though the bell skips it', async () => {
    const { listener, mailService } = makeListener();

    await listener.onAssigned({ taskId: 1, assigneeUserId: 3, actorId: 3 });

    expect(mailService.sendMail).toHaveBeenCalled();
  });

  it('skips the email when the assignee has no address on file', async () => {
    const { listener, mailService } = makeListener({
      usersRepository: { findById: jest.fn().mockResolvedValue(null) },
    });

    await listener.onAssigned({ taskId: 1, assigneeUserId: 7, actorId: 3 });

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('does not throw, and still leaves the in-app notification in place, when mail fails', async () => {
    const { listener, notificationsService } = makeListener({
      mailService: { sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) },
    });

    await expect(
      listener.onAssigned({ taskId: 1, assigneeUserId: 7, actorId: 3 }),
    ).resolves.toBeUndefined();
    expect(notificationsService.create).toHaveBeenCalled();
  });

  it('does not email for status changes, blocks, or comments', async () => {
    const { listener, mailService } = makeListener({
      taskWatchersRepository: { findUserIdsForTask: jest.fn().mockResolvedValue([7]) },
    });

    await listener.onStatusChanged({ taskId: 1, actorId: 3, from: 'todo', to: 'in_progress' });
    await listener.onBlocked({ taskId: 1, actorId: 3, reason: 'waiting on permit' });
    await listener.onCommented({ taskId: 1, commentId: 42, actorId: 3 });

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});
