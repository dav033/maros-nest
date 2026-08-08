import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { NotePage } from '../../../../entities/note-page.entity';

export interface NoteSearchRow {
  id: number;
  title: string;
  icon: string | null;
  parent_id: number | null;
  updated_at: Date;
  rank: number;
}

@Injectable()
export class NotesRepository {
  constructor(
    @InjectRepository(NotePage)
    private readonly repo: Repository<NotePage>,
  ) {}

  /**
   * A page is visible to userId unless it's a private standalone note owned by
   * someone else — see note-access.util.ts for the same rule applied to a
   * single already-fetched row. userId undefined (MCP's shared-token context,
   * no per-user identity) skips the filter entirely and sees everything.
   */
  private applyVisibility(
    qb: SelectQueryBuilder<NotePage>,
    userId?: number,
  ): SelectQueryBuilder<NotePage> {
    if (userId === undefined) return qb;
    return qb.andWhere(
      '(page.entity_kind IS NOT NULL OR page.owner_id IS NULL OR page.owner_id = :userId)',
      { userId },
    );
  }

  async findAllActive(userId?: number): Promise<NotePage[]> {
    const qb = this.repo
      .createQueryBuilder('page')
      .leftJoinAndSelect('page.parent', 'parent')
      .leftJoinAndSelect('page.tags', 'tags')
      .where('page.deleted_at IS NULL')
      .orderBy('page.position', 'ASC')
      .addOrderBy('page.id', 'ASC');
    return this.applyVisibility(qb, userId).getMany();
  }

  /** Only the top-level page of each trashed subtree — cascaded descendants stay hidden. */
  async findTrashedRoots(userId?: number): Promise<NotePage[]> {
    const qb = this.repo
      .createQueryBuilder('page')
      .leftJoinAndSelect('page.parent', 'parent')
      .leftJoinAndSelect('page.tags', 'tags')
      .where('page.deleted_at IS NOT NULL')
      .andWhere('page.trashed_root_id = page.id')
      .orderBy('page.deleted_at', 'DESC');
    return this.applyVisibility(qb, userId).getMany();
  }

  async findFavorites(userId?: number): Promise<NotePage[]> {
    const qb = this.repo
      .createQueryBuilder('page')
      .leftJoinAndSelect('page.parent', 'parent')
      .leftJoinAndSelect('page.tags', 'tags')
      .where('page.deleted_at IS NULL')
      .andWhere('page.is_favorite = true')
      .orderBy('page.updated_at', 'DESC');
    return this.applyVisibility(qb, userId).getMany();
  }

  async findByIdActive(id: number): Promise<NotePage | null> {
    return this.repo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['parent', 'tags'],
    });
  }

  async findById(id: number): Promise<NotePage | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['parent', 'tags'],
    });
  }

  async findByEntity(entityKind: string, entityId: number): Promise<NotePage[]> {
    return this.repo.find({
      where: { entityKind, entityId, deletedAt: IsNull() },
      relations: ['parent', 'tags'],
      order: { position: 'ASC', id: 'ASC' },
    });
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

  // $3 IS NULL makes the whole OR true — that's how MCP's undefined userId
  // (no per-user identity, shared-token auth) bypasses the filter entirely.
  async search(query: string, limit: number, userId?: number): Promise<NoteSearchRow[]> {
    return this.repo.query(
      `
      SELECT id, title, icon, parent_id, updated_at,
             ts_rank(content_tsv, plainto_tsquery('simple', $1)) AS rank
      FROM note_pages
      WHERE deleted_at IS NULL
        AND content_tsv @@ plainto_tsquery('simple', $1)
        AND (entity_kind IS NOT NULL OR owner_id IS NULL OR owner_id = $3 OR $3::int IS NULL)
      ORDER BY rank DESC, updated_at DESC
      LIMIT $2
      `,
      [query, limit, userId ?? null],
    );
  }
}
