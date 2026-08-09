import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { NotePage } from '../../../../entities/note-page.entity';
import { NotePageFavorite } from '../../../../entities/note-page-favorite.entity';
import type { NoteActor } from '../services/note-access.service';

export interface NoteSearchRow {
  id: number;
  title: string;
  icon: string | null;
  parent_id: number | null;
  updated_at: Date;
  rank: number;
}

/** Relations every read needs: the parent (for parentId), tags, and the last editor. */
const PAGE_RELATIONS = ['parent', 'tags', 'lastEditedBy'];

@Injectable()
export class NotesRepository {
  constructor(
    @InjectRepository(NotePage)
    private readonly repo: Repository<NotePage>,
    @InjectRepository(NotePageFavorite)
    private readonly favorites: Repository<NotePageFavorite>,
  ) {}

  /**
   * SQL form of the rule NoteAccessService applies to a single loaded page: a page is
   * visible when it is a team page, when the caller owns it, or when a grant on it or
   * on any ancestor reaches the caller.
   *
   * The third arm walks *down* — a grant on a folder covers everything inside it —
   * which is the mirror image of NoteSharesRepository, where the same relationship is
   * resolved by walking up from one page. Both must stay in step; the shared rule is
   * documented once, in NoteAccessService.
   *
   * Returns SQL with `:userId` / `:roleId` placeholders for the caller to bind.
   */
  private static visibleCondition(roleId: number | null): string {
    const subjectMatch =
      roleId === null
        ? `s.subject_type = 'user' AND s.subject_id = :userId`
        : `((s.subject_type = 'user' AND s.subject_id = :userId)
             OR (s.subject_type = 'role' AND s.subject_id = :roleId))`;

    return `(
      page.visibility = 'team'
      OR page.owner_id = :userId
      OR page.id IN (
        WITH RECURSIVE granted AS (
          SELECT s.note_page_id AS id
          FROM note_page_shares s
          WHERE ${subjectMatch}
            AND (s.expires_at IS NULL OR s.expires_at > now())
          UNION
          SELECT c.id FROM note_pages c JOIN granted g ON c.parent_id = g.id
        )
        SELECT id FROM granted
      )
    )`;
  }

  /**
   * `actor` undefined is the MCP shared-token context: no per-user identity to filter
   * against, deliberately trusted with everything. See NoteAccessService.
   */
  private applyVisibility(
    qb: SelectQueryBuilder<NotePage>,
    actor?: NoteActor,
  ): SelectQueryBuilder<NotePage> {
    if (!actor) return qb;
    return qb.andWhere(NotesRepository.visibleCondition(actor.roleId), {
      userId: actor.id,
      roleId: actor.roleId,
    });
  }

  private baseQuery(): SelectQueryBuilder<NotePage> {
    return this.repo
      .createQueryBuilder('page')
      .leftJoinAndSelect('page.parent', 'parent')
      .leftJoinAndSelect('page.tags', 'tags')
      .leftJoinAndSelect('page.lastEditedBy', 'lastEditedBy');
  }

  async findAllActive(actor?: NoteActor): Promise<NotePage[]> {
    const qb = this.baseQuery()
      .where('page.deleted_at IS NULL')
      .orderBy('page.position', 'ASC')
      .addOrderBy('page.id', 'ASC');
    return this.applyVisibility(qb, actor).getMany();
  }

  /** Only the top-level page of each trashed subtree — cascaded descendants stay hidden. */
  async findTrashedRoots(actor?: NoteActor): Promise<NotePage[]> {
    const qb = this.baseQuery()
      .where('page.deleted_at IS NOT NULL')
      .andWhere('page.trashed_root_id = page.id')
      .orderBy('page.deleted_at', 'DESC');
    return this.applyVisibility(qb, actor).getMany();
  }

  /**
   * Pages the caller reaches *only* through a grant — the "Shared with me" list.
   * Anything they could already see as a team page or as its owner is excluded, or the
   * list would just be a second copy of the whole workspace.
   *
   * Only the pages carrying a grant are returned, not their descendants: the tree
   * expands from these, and returning the subtree too would render each branch twice.
   */
  async findSharedWithMe(actor: NoteActor): Promise<NotePage[]> {
    const subjectMatch =
      actor.roleId === null
        ? `s.subject_type = 'user' AND s.subject_id = :userId`
        : `((s.subject_type = 'user' AND s.subject_id = :userId)
             OR (s.subject_type = 'role' AND s.subject_id = :roleId))`;

    return this.baseQuery()
      .where('page.deleted_at IS NULL')
      .andWhere(`page.visibility <> 'team'`)
      .andWhere('(page.owner_id IS NULL OR page.owner_id <> :userId)')
      .andWhere(
        `EXISTS (
           SELECT 1 FROM note_page_shares s
           WHERE s.note_page_id = page.id
             AND ${subjectMatch}
             AND (s.expires_at IS NULL OR s.expires_at > now())
         )`,
        { userId: actor.id, roleId: actor.roleId },
      )
      .orderBy('page.updated_at', 'DESC')
      .getMany();
  }

  /**
   * Favorites are per user. The MCP context (actor undefined, shared token, no
   * per-user identity) has no favorites list of its own and gets an empty one.
   *
   * The visibility filter still applies: losing access to a note has to take it out of
   * your favorites too, not leave a starred row you can no longer open.
   */
  async findFavorites(actor?: NoteActor): Promise<NotePage[]> {
    if (!actor) return [];
    const qb = this.baseQuery()
      .innerJoin(
        'note_page_favorites',
        'fav',
        'fav.note_page_id = page.id AND fav.user_id = :favUserId',
        { favUserId: actor.id },
      )
      .where('page.deleted_at IS NULL')
      .orderBy('page.updated_at', 'DESC');
    return this.applyVisibility(qb, actor).getMany();
  }

  /** Ids the user has starred, for stamping isFavorite onto a list in one extra query. */
  async findFavoriteIds(actor?: NoteActor): Promise<Set<number>> {
    if (!actor) return new Set();
    const rows = await this.favorites.find({
      where: { userId: actor.id },
      select: { notePageId: true },
    });
    return new Set(rows.map((row) => row.notePageId));
  }

  async isFavorite(pageId: number, userId?: number): Promise<boolean> {
    if (userId === undefined) return false;
    const count = await this.favorites.count({ where: { notePageId: pageId, userId } });
    return count > 0;
  }

  async addFavorite(pageId: number, userId: number): Promise<void> {
    // Starring an already-starred page must stay a no-op: the UI fires this on every
    // toggle without checking the current state first.
    await this.favorites
      .createQueryBuilder()
      .insert()
      .values({ notePageId: pageId, userId })
      .orIgnore()
      .execute();
  }

  async removeFavorite(pageId: number, userId: number): Promise<void> {
    await this.favorites.delete({ notePageId: pageId, userId });
  }

  async findByIdActive(id: number): Promise<NotePage | null> {
    return this.repo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: PAGE_RELATIONS,
    });
  }

  async findById(id: number): Promise<NotePage | null> {
    return this.repo.findOne({
      where: { id },
      relations: PAGE_RELATIONS,
    });
  }

  /**
   * Notes attached to a lead/project/contact/company. The visibility filter applies
   * here too now: attaching a note to an entity used to make it shared by definition,
   * but visibility is its own column since db/notes-sharing.sql, so an entity note can
   * be private and must not leak into the entity's panel for everyone.
   */
  async findByEntity(
    entityKind: string,
    entityId: number,
    actor?: NoteActor,
  ): Promise<NotePage[]> {
    const qb = this.baseQuery()
      .where('page.deleted_at IS NULL')
      .andWhere('page.entity_kind = :entityKind', { entityKind })
      .andWhere('page.entity_id = :entityId', { entityId })
      .orderBy('page.position', 'ASC')
      .addOrderBy('page.id', 'ASC');
    return this.applyVisibility(qb, actor).getMany();
  }

  async save(page: NotePage): Promise<NotePage> {
    return this.repo.save(page);
  }

  async purge(id: number): Promise<void> {
    // FK is ON DELETE CASCADE, so this also removes the whole trashed subtree.
    await this.repo.delete(id);
  }

  async getMaxPositionUnderParent(parentId: number | null): Promise<number> {
    const qb = this.repo
      .createQueryBuilder('page')
      .select('MAX(page.position)', 'max');
    if (parentId === null) {
      qb.where('page.parent_id IS NULL');
    } else {
      qb.where('page.parent_id = :parentId', { parentId });
    }
    const result: { max: number | null } | undefined = await qb.getRawOne();
    return result?.max ?? 0;
  }

  /** Ordered active siblings under a parent, for computing an insert/move position. */
  async getSiblings(
    parentId: number | null,
    excludeId?: number,
  ): Promise<Array<{ id: number; position: number }>> {
    const qb = this.repo
      .createQueryBuilder('page')
      .select(['page.id AS id', 'page.position AS position'])
      .where('page.deleted_at IS NULL');
    qb.andWhere(
      parentId === null ? 'page.parent_id IS NULL' : 'page.parent_id = :parentId',
      { parentId },
    );
    if (excludeId != null) {
      qb.andWhere('page.id != :excludeId', { excludeId });
    }
    qb.orderBy('page.position', 'ASC');
    const rows: Array<{ id: number; position: number }> = await qb.getRawMany();
    return rows;
  }

  /** Reassigns positions to clean multiples of the step, preserving the given order. */
  async rebalanceSiblings(orderedIds: number[], step: number): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        this.repo.update(id, { position: (index + 1) * step }),
      ),
    );
  }

  /**
   * Whether this page or any of its ancestors carries a grant — i.e. whether moving a
   * child out of it would take access away from someone. Existence check only: the move
   * response just needs a yes/no to decide whether to warn.
   */
  async hasGrantsOnAncestry(pageId: number): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await this.repo.query(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM note_pages WHERE id = $1
        UNION ALL
        SELECT p.id, p.parent_id FROM note_pages p JOIN ancestors a ON p.id = a.parent_id
      )
      SELECT EXISTS (
        SELECT 1 FROM note_page_shares s
        JOIN ancestors a ON a.id = s.note_page_id
        WHERE s.expires_at IS NULL OR s.expires_at > now()
      ) AS exists
      `,
      [pageId],
    );
    return rows[0]?.exists === true;
  }

  /**
   * A page and every active descendant, in tree order.
   *
   * No visibility filter, and that is intentional: the only caller is the public
   * reader, where the share link *is* the authorisation. Publishing a folder is an
   * explicit act over everything inside it, so a private child inside a published
   * folder is published too — the share dialog says how many pages that covers before
   * the link is created.
   */
  async findSubtree(rootId: number): Promise<NotePage[]> {
    const ids: Array<{ id: number }> = await this.repo.query(
      `
      WITH RECURSIVE subtree AS (
        SELECT id FROM note_pages WHERE id = $1 AND deleted_at IS NULL
        UNION ALL
        SELECT c.id FROM note_pages c
        JOIN subtree s ON c.parent_id = s.id
        WHERE c.deleted_at IS NULL
      )
      SELECT id FROM subtree
      `,
      [rootId],
    );
    if (ids.length === 0) return [];

    return this.baseQuery()
      .where('page.id IN (:...ids)', { ids: ids.map((row) => row.id) })
      .orderBy('page.position', 'ASC')
      .addOrderBy('page.id', 'ASC')
      .getMany();
  }

  /**
   * Whether `pageId` sits under `rootId`. This is what stops a share link for one
   * folder being pointed at an unrelated note by editing the id in the URL.
   */
  async isDescendantOf(pageId: number, rootId: number): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await this.repo.query(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM note_pages WHERE id = $1 AND deleted_at IS NULL
        UNION ALL
        SELECT p.id, p.parent_id FROM note_pages p
        JOIN ancestors a ON p.id = a.parent_id
        WHERE p.deleted_at IS NULL
      )
      SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = $2) AS exists
      `,
      [pageId, rootId],
    );
    return rows[0]?.exists === true;
  }

  /** Lightweight (id, parentId) pairs of all active pages, for in-memory cycle checks. */
  async getActiveParentMap(): Promise<Array<{ id: number; parentId: number | null }>> {
    const rows: Array<{ id: number; parent_id: number | null }> = await this.repo
      .createQueryBuilder('page')
      .select(['page.id AS id', 'page.parent_id AS parent_id'])
      .where('page.deleted_at IS NULL')
      .getRawMany();
    return rows.map((row) => ({ id: row.id, parentId: row.parent_id }));
  }

  /**
   * Soft-deletes a page and its whole active subtree in one statement, stamping every
   * affected row with trashed_root_id = rootId so restore only touches this subtree.
   */
  async trashSubtree(rootId: number): Promise<void> {
    await this.repo.query(
      `
      WITH RECURSIVE subtree AS (
        SELECT id FROM note_pages WHERE id = $1
        UNION ALL
        SELECT c.id FROM note_pages c
        JOIN subtree s ON c.parent_id = s.id
        WHERE c.deleted_at IS NULL
      )
      UPDATE note_pages
      SET deleted_at = now(), trashed_root_id = $1
      WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
      `,
      [rootId],
    );
  }

  /** Restores a previously trashed subtree, detaching it to the root if its old parent is gone. */
  async restoreSubtree(rootId: number): Promise<void> {
    await this.repo.query(
      `
      UPDATE note_pages
      SET deleted_at = NULL, trashed_root_id = NULL
      WHERE trashed_root_id = $1
      `,
      [rootId],
    );
    await this.repo.query(
      `
      UPDATE note_pages p
      SET parent_id = NULL
      WHERE p.id = $1
        AND p.parent_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM note_pages q WHERE q.id = p.parent_id AND q.deleted_at IS NULL
        )
      `,
      [rootId],
    );
  }

  /**
   * Full-text search, filtered by the same visibility rule as every list query.
   *
   * This is raw SQL rather than the query builder (ts_rank / tsquery have no builder
   * equivalent), so the rule has to be restated here — the one place it can silently
   * drift out of step. If a note you were just granted does not turn up in search, this
   * query is why. `$3::int IS NULL` is how MCP's undefined actor bypasses the filter.
   */
  async search(
    query: string,
    limit: number,
    actor?: NoteActor,
  ): Promise<NoteSearchRow[]> {
    return this.repo.query(
      `
      SELECT id, title, icon, parent_id, updated_at,
             ts_rank(content_tsv, plainto_tsquery('simple', $1)) AS rank
      FROM note_pages
      WHERE deleted_at IS NULL
        AND content_tsv @@ plainto_tsquery('simple', $1)
        AND (
          $3::int IS NULL
          OR visibility = 'team'
          OR owner_id = $3
          OR id IN (
            WITH RECURSIVE granted AS (
              SELECT s.note_page_id AS id
              FROM note_page_shares s
              WHERE (
                      (s.subject_type = 'user' AND s.subject_id = $3)
                   OR (s.subject_type = 'role' AND $4::int IS NOT NULL AND s.subject_id = $4)
                    )
                AND (s.expires_at IS NULL OR s.expires_at > now())
              UNION
              SELECT c.id FROM note_pages c JOIN granted g ON c.parent_id = g.id
            )
            SELECT id FROM granted
          )
        )
      ORDER BY rank DESC, updated_at DESC
      LIMIT $2
      `,
      [query, limit, actor?.id ?? null, actor?.roleId ?? null],
    );
  }
}
