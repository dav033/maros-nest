import { Injectable } from '@nestjs/common';
import { NotePage } from '../../../../entities/note-page.entity';

@Injectable()
export class NoteMapper {
  /**
   * Lightweight row for the tree/list views — no content.
   *
   * `favoriteIds` is the calling user's starred set (favorites are per user, so the
   * flag can't live on the row). Omitting it reads as "nobody is asking", which is
   * the MCP shared-token case: everything comes back unstarred.
   *
   * lastEditedBy is denormalized on purpose: GET /users requires `users:read`, which
   * members don't have, so the client cannot resolve a user id into a name itself.
   */
  toSummaryDto(entity: NotePage, favoriteIds?: Set<number>): any {
    return {
      id: entity.id,
      parentId: entity.parent?.id ?? null,
      kind: entity.kind ?? 'page',
      title: entity.title,
      icon: entity.icon ?? null,
      position: entity.position,
      isFavorite: favoriteIds?.has(entity.id) ?? false,
      entityKind: entity.entityKind ?? null,
      entityId: entity.entityId ?? null,
      deletedAt: entity.deletedAt ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdById: entity.createdById ?? null,
      lastEditedBy: entity.lastEditedBy
        ? {
            id: entity.lastEditedBy.id,
            name: entity.lastEditedBy.name ?? null,
            email: entity.lastEditedBy.email,
            picture: entity.lastEditedBy.picture ?? null,
          }
        : null,
      tags: (entity.tags ?? []).map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
    };
  }

  /** Full page including the TipTap document. */
  toDetailDto(entity: NotePage, favoriteIds?: Set<number>): any {
    return {
      ...this.toSummaryDto(entity, favoriteIds),
      content: entity.content ?? {},
    };
  }
}
