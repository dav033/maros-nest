import { Injectable } from '@nestjs/common';
import { NotePage } from '../../../../entities/note-page.entity';
import { NoteAccess } from '../services/note-access.service';

/**
 * Which pages in a list carry grants or a live public link, resolved in two set queries
 * so the tree can render its badges without asking per row.
 */
export interface NoteListBadges {
  sharedIds: Set<number>;
  publishedIds: Set<number>;
}

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
   *
   * `myAccess` is deliberately absent here. Resolving it means one grant lookup per
   * page, and a tree of 200 notes would pay 200 queries to render badges nobody reads;
   * the detail DTO carries it for the one page actually open.
   */
  toSummaryDto(
    entity: NotePage,
    favoriteIds?: Set<number>,
    badges?: NoteListBadges,
  ): any {
    return {
      id: entity.id,
      parentId: entity.parent?.id ?? null,
      kind: entity.kind ?? 'page',
      title: entity.title,
      icon: entity.icon ?? null,
      position: entity.position,
      isFavorite: favoriteIds?.has(entity.id) ?? false,
      visibility: entity.visibility ?? 'team',
      isShared: badges?.sharedIds.has(entity.id) ?? false,
      isPublished: badges?.publishedIds.has(entity.id) ?? false,
      entityKind: entity.entityKind ?? null,
      entityId: entity.entityId ?? null,
      deletedAt: entity.deletedAt ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdById: entity.createdById ?? null,
      ownerId: entity.ownerId ?? null,
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

  /** Full page including the TipTap document, plus what the caller may do with it. */
  toDetailDto(
    entity: NotePage,
    favoriteIds?: Set<number>,
    myAccess?: NoteAccess,
    badges?: NoteListBadges,
  ): any {
    return {
      ...this.toSummaryDto(entity, favoriteIds, badges),
      content: entity.content ?? {},
      myAccess: myAccess ?? 'owner',
    };
  }

  /**
   * What a share link exposes to the internet.
   *
   * This is an explicit allow-list, not the detail DTO minus a few fields, and it must
   * stay that way: an omit-based version silently publishes whatever gets added to the
   * internal DTO later. note-public.mapper.spec.ts fails if a key appears here that the
   * test does not know about — that failure is the point of the test.
   *
   * Absent on purpose: internal ids (a numeric id invites walking the range),
   * entityKind/entityId (reveals that a lead exists and which one), ownership,
   * position, favorites, and every email address.
   */
  toPublicDto(
    entity: NotePage,
    options: { showAuthor: boolean },
  ): Record<string, unknown> {
    return {
      /**
       * The one internal id that does cross the boundary, and only because a published
       * folder has to be navigable. It is not a capability: every public read checks
       * that the requested page really sits inside the link's subtree, so a guessed id
       * from another note answers 404. Nothing else numeric ships with it.
       */
      id: entity.id,
      title: entity.title,
      icon: entity.icon ?? null,
      kind: entity.kind ?? 'page',
      content: entity.content ?? {},
      updatedAt: entity.updatedAt,
      author:
        options.showAuthor && entity.lastEditedBy
          ? {
              name: entity.lastEditedBy.name ?? null,
              picture: entity.lastEditedBy.picture ?? null,
            }
          : null,
      tags: (entity.tags ?? []).map((tag) => ({ name: tag.name, color: tag.color })),
    };
  }
}
