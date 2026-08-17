import { TaskDigestCron } from './task-digest.cron';
import { TaskMapper } from '../task-management/mappers/task.mapper';
import { Task } from '../../../entities/task.entity';
import { User } from '../../../entities/user.entity';

function user(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), { id: 1, email: 'crew@marosconstruction.com', ...overrides });
}

function task(overrides: Partial<Task> = {}): Task {
  return Object.assign(new Task(), { id: 1, title: 'Task', assignee: user(), ...overrides });
}

function makeCron(
  overrides: {
    tasksRepository?: Record<string, jest.Mock>;
    mailService?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
    notificationsService?: Record<string, jest.Mock>;
    usersRepository?: Record<string, jest.Mock>;
  } = {},
) {
  const tasksRepository = {
    findDueForDigest: jest.fn().mockResolvedValue([]),
    ...overrides.tasksRepository,
  };
  const mailService = {
    sendMail: jest.fn().mockResolvedValue({ sent: true, messageId: 'abc123' }),
    ...overrides.mailService,
  };
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
    ...overrides.configService,
  };
  const notificationsService = overrides.notificationsService
    ? { create: jest.fn().mockResolvedValue(undefined), ...overrides.notificationsService }
    : undefined;
  const usersRepository = overrides.usersRepository
    ? { findNotificationPreferences: jest.fn().mockResolvedValue({ digest: 'email', digestHour: 7 }), ...overrides.usersRepository }
    : undefined;

  const cron = new TaskDigestCron(
    tasksRepository as never,
    new TaskMapper(),
    mailService as never,
    configService as never,
    notificationsService as never,
    usersRepository as never,
  );

  return { cron, tasksRepository, mailService, configService, notificationsService, usersRepository };
}

describe('TaskDigestCron.sendDailyDigest', () => {
  it('sends nothing when no task is due', async () => {
    const { cron, mailService } = makeCron();

    await cron.sendDailyDigest();

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('sends one email per assignee, splitting overdue from due-today', async () => {
    const today = TaskMapper.todayInBusinessTimezone();
    const alice = user({ id: 1, email: 'alice@marosconstruction.com' });
    const bob = user({ id: 2, email: 'bob@marosconstruction.com' });
    const { cron, mailService } = makeCron({
      tasksRepository: {
        findDueForDigest: jest.fn().mockResolvedValue([
          task({ id: 1, title: 'Pour foundation', assignee: alice, dueDate: '2020-01-01' }),
          task({ id: 2, title: 'Order lumber', assignee: alice, dueDate: today }),
          task({ id: 3, title: 'Inspect wiring', assignee: bob, dueDate: today }),
        ]),
      },
    });

    await cron.sendDailyDigest();

    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['alice@marosconstruction.com'],
        text: expect.stringContaining('Overdue (1)'),
      }),
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['alice@marosconstruction.com'],
        text: expect.stringContaining('Due today (1)'),
      }),
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['bob@marosconstruction.com'] }),
    );
  });

  it('skips an assignee with no email on file', async () => {
    const { cron, mailService } = makeCron({
      tasksRepository: {
        findDueForDigest: jest
          .fn()
          .mockResolvedValue([task({ assignee: user({ email: undefined }) })]),
      },
    });

    await cron.sendDailyDigest();

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it("one assignee's mail failure does not stop another's digest", async () => {
    const alice = user({ id: 1, email: 'alice@marosconstruction.com' });
    const bob = user({ id: 2, email: 'bob@marosconstruction.com' });
    const { cron, mailService } = makeCron({
      tasksRepository: {
        findDueForDigest: jest
          .fn()
          .mockResolvedValue([task({ id: 1, assignee: alice }), task({ id: 2, assignee: bob })]),
      },
      mailService: {
        sendMail: jest
          .fn()
          .mockRejectedValueOnce(new Error('smtp down'))
          .mockResolvedValueOnce({ sent: true }),
      },
    });

    await expect(cron.sendDailyDigest()).resolves.toBeUndefined();

    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
  });

  it('swallows a repository failure instead of throwing', async () => {
    const { cron } = makeCron({
      tasksRepository: { findDueForDigest: jest.fn().mockRejectedValue(new Error('db down')) },
    });

    await expect(cron.sendDailyDigest()).resolves.toBeUndefined();
  });

  it('delivers the digest in-app at the user-selected hour', async () => {
    const today = TaskMapper.todayInBusinessTimezone();
    const { cron, mailService, notificationsService } = makeCron({
      tasksRepository: {
        findSignalsForDigest: jest.fn().mockResolvedValue([task({ dueDate: today })]),
      },
      usersRepository: {
        findNotificationPreferences: jest.fn().mockResolvedValue({
          digest: 'in_app',
          digestHour: TaskMapper.currentHourInBusinessTimezone(),
        }),
      },
      notificationsService: { create: jest.fn().mockResolvedValue(undefined) },
    });

    await cron.sendDailyDigest();

    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(notificationsService!.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'task_due_digest', entityId: 1 }),
    );
  });
});
