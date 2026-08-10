import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification, NotificationKind } from '../../../entities/notification.entity';

export interface CreateNotificationInput {
  userId: number;
  kind: NotificationKind;
  actorId: number | null;
  entityKind?: string | null;
  entityId?: number | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const row = this.repo.create(input);
    return this.repo.save(row);
  }

  async findForUser(
    userId: number,
    options: { unreadOnly?: boolean; limit?: number },
  ): Promise<Notification[]> {
    const qb = this.repo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.actor', 'actor')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .take(options.limit ?? 30);
    if (options.unreadOnly) {
      qb.andWhere('n.read_at IS NULL');
    }
    return qb.getMany();
  }

  async countUnread(userId: number): Promise<number> {
    return this.repo.count({ where: { userId, readAt: IsNull() } });
  }

  /** No-op if the notification doesn't belong to this user — see NotificationsService. */
  async markRead(id: number, userId: number): Promise<void> {
    await this.repo.update({ id, userId }, { readAt: new Date() });
  }

  async markAllRead(userId: number): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date() })
      .where('user_id = :userId AND read_at IS NULL', { userId })
      .execute();
  }
}
