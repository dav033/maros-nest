import { Injectable } from '@nestjs/common';
import { NotificationsRepository, CreateNotificationInput } from './repositories/notifications.repository';
import { NotificationMapper } from './mappers/notification.mapper';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly mapper: NotificationMapper,
  ) {}

  async list(userId: number, unreadOnly: boolean, limit?: number): Promise<any[]> {
    const rows = await this.notificationsRepository.findForUser(userId, { unreadOnly, limit });
    return rows.map((row) => this.mapper.toDto(row));
  }

  async unreadCount(userId: number): Promise<number> {
    return this.notificationsRepository.countUnread(userId);
  }

  /**
   * Scoped to `userId` at the repository layer (a WHERE, not a post-hoc check), so
   * marking someone else's notification id read is silently a no-op rather than a 403
   * that would confirm the id exists.
   */
  async markRead(id: number, userId: number): Promise<void> {
    await this.notificationsRepository.markRead(id, userId);
  }

  async markAllRead(userId: number): Promise<void> {
    await this.notificationsRepository.markAllRead(userId);
  }

  async create(input: CreateNotificationInput): Promise<void> {
    await this.notificationsRepository.create(input);
  }
}
