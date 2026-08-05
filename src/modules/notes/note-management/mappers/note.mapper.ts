import { Injectable } from '@nestjs/common';
import { NotePage } from '../../../../entities/note-page.entity';

@Injectable()
export class NoteMapper {
  /** Lightweight row for the tree/list views — no content, no tags. */
  toSummaryDto(entity: NotePage): any {
    return {
      id: entity.id,
      parentId: entity.parent?.id ?? null,
      title: entity.title,
      icon: entity.icon ?? null,
      position: entity.position,
      isFavorite: entity.isFavorite,
      entityKind: entity.entityKind ?? null,
      entityId: entity.entityId ?? null,
      deletedAt: entity.deletedAt ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      tags: (entity.tags ?? []).map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
    };
  }

  /** Full page including the TipTap document. */
  toDetailDto(entity: NotePage): any {
    return {
      ...this.toSummaryDto(entity),
      content: entity.content ?? {},
    };
  }
}
