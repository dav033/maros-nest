import { Injectable } from '@nestjs/common';
import { Notification } from '../../../entities/notification.entity';

@Injectable()
export class NotificationMapper {
  toDto(entity: Notification): any {
    return {
      id: entity.id,
      kind: entity.kind,
      actor: entity.actor
        ? {
            id: entity.actor.id,
            name: entity.actor.name ?? null,
            email: entity.actor.email,
            picture: entity.actor.picture ?? null,
          }
        : null,
      entityKind: entity.entityKind ?? null,
      entityId: entity.entityId ?? null,
      payload: entity.payload ?? {},
      readAt: entity.readAt ?? null,
      createdAt: entity.createdAt,
    };
  }
}
