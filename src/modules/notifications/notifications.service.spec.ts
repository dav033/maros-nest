import { NotificationsService } from './notifications.service';
import { NotificationMapper } from './mappers/notification.mapper';

function makeService(overrides: Record<string, jest.Mock> = {}) {
  const notificationsRepository = {
    findForUser: jest.fn().mockResolvedValue([]),
    countUnread: jest.fn().mockResolvedValue(0),
    markRead: jest.fn().mockResolvedValue(undefined),
    markAllRead: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  const service = new NotificationsService(notificationsRepository as never, new NotificationMapper());
  return { service, notificationsRepository };
}

describe('NotificationsService', () => {
  it('scopes list to the calling user', async () => {
    const { service, notificationsRepository } = makeService();

    await service.list(5, true, 10);

    expect(notificationsRepository.findForUser).toHaveBeenCalledWith(5, {
      unreadOnly: true,
      limit: 10,
    });
  });

  it('scopes markRead to the calling user, not just the notification id', async () => {
    const { service, notificationsRepository } = makeService();

    await service.markRead(99, 5);

    expect(notificationsRepository.markRead).toHaveBeenCalledWith(99, 5);
  });

  it('scopes markAllRead to the calling user', async () => {
    const { service, notificationsRepository } = makeService();

    await service.markAllRead(5);

    expect(notificationsRepository.markAllRead).toHaveBeenCalledWith(5);
  });

  it('scopes unreadCount to the calling user', async () => {
    const { service, notificationsRepository } = makeService();

    await service.unreadCount(5);

    expect(notificationsRepository.countUnread).toHaveBeenCalledWith(5);
  });
});
