import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { NotePageLink } from '../../../../entities/note-page-link.entity';
import { NotePageLinkView } from '../../../../entities/note-page-link-view.entity';

export interface LinkViewStatsRow {
  day: string;
  views: number;
}

/** The columns a link update is allowed to touch. */
export type NoteLinkColumnChanges = Partial<
  Pick<
    NotePageLink,
    | 'passwordHash'
    | 'includeChildren'
    | 'allowIndexing'
    | 'showAuthor'
    | 'expiresAt'
    | 'revokedAt'
    | 'lastViewedAt'
  >
>;

/**
 * A link is *active* when it has not been revoked and has not expired. That pair of
 * conditions is the difference between a working URL and a dead one, so it is written
 * once here and reused rather than repeated at each call site.
 */
const ACTIVE_LINK_SQL = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;

@Injectable()
export class NoteLinksRepository {
  constructor(
    @InjectRepository(NotePageLink)
    private readonly repo: Repository<NotePageLink>,
    @InjectRepository(NotePageLinkView)
    private readonly views: Repository<NotePageLinkView>,
  ) {}

  /**
   * The only lookup the public reader performs. Takes the SHA-256 of the token, never
   * the token: the raw value exists in the URL and nowhere else.
   *
   * Revoked and expired links are returned rather than filtered out — the guard has to
   * tell them apart to answer 404 for one and 410 for the other.
   */
  async findByTokenHash(tokenHash: string): Promise<NotePageLink | null> {
    return this.repo.findOne({ where: { tokenHash }, relations: ['page'] });
  }

  async findById(id: number): Promise<NotePageLink | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByPage(notePageId: number): Promise<NotePageLink[]> {
    return this.repo.find({
      where: { notePageId },
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async save(link: NotePageLink): Promise<NotePageLink> {
    return this.repo.save(link);
  }

  /**
   * Columns only — no relations. Narrower than Partial<NotePageLink> on purpose: the
   * entity's `page` relation has no business travelling through an UPDATE.
   */
  async update(id: number, changes: NoteLinkColumnChanges): Promise<void> {
    await this.repo.update(id, changes);
  }

  /** Which of these pages are published right now, for the tree's globe badge. */
  async findPublishedPageIds(pageIds: number[]): Promise<Set<number>> {
    if (pageIds.length === 0) return new Set();
    const rows: Array<{ note_page_id: number }> = await this.repo.query(
      `
      SELECT DISTINCT note_page_id
      FROM note_page_links
      WHERE note_page_id = ANY($1::int[]) AND ${ACTIVE_LINK_SQL}
      `,
      [pageIds],
    );
    return new Set(rows.map((row) => row.note_page_id));
  }

  /**
   * Every live link in the workspace, for the admin panel. This is the view that
   * matters the day somebody leaves the company and nobody remembers what they
   * published.
   */
  async findAllActive(): Promise<NotePageLink[]> {
    return this.repo
      .createQueryBuilder('link')
      .leftJoinAndSelect('link.page', 'page')
      .leftJoinAndSelect('link.createdBy', 'createdBy')
      .where('link.revoked_at IS NULL')
      .andWhere('(link.expires_at IS NULL OR link.expires_at > now())')
      .andWhere('page.deleted_at IS NULL')
      .orderBy('link.created_at', 'DESC')
      .getMany();
  }

  /**
   * Counting a view must never block serving the page, so this runs detached; a lost
   * counter increment is a far smaller problem than a slow public read.
   */
  async recordView(view: {
    linkId: number;
    ipHash: string | null;
    userAgent: string | null;
    referer: string | null;
  }): Promise<void> {
    await this.views.insert(view);
    await this.repo.increment({ id: view.linkId }, 'viewCount', 1);
    await this.repo.update(view.linkId, { lastViewedAt: new Date() });
  }

  async countUniqueVisitors(linkId: number): Promise<number> {
    const rows: Array<{ count: string }> = await this.views.query(
      `SELECT count(DISTINCT ip_hash) AS count FROM note_page_link_views WHERE link_id = $1`,
      [linkId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async findRecentViews(linkId: number, limit: number): Promise<NotePageLinkView[]> {
    return this.views.find({
      where: { linkId },
      order: { viewedAt: 'DESC' },
      take: limit,
    });
  }

  /** Daily totals for the last `days` days, for the sparkline in the share dialog. */
  async findViewsByDay(linkId: number, days: number): Promise<LinkViewStatsRow[]> {
    const rows: Array<{ day: string; views: string }> = await this.views.query(
      `
      SELECT to_char(date_trunc('day', viewed_at), 'YYYY-MM-DD') AS day,
             count(*) AS views
      FROM note_page_link_views
      WHERE link_id = $1 AND viewed_at > now() - ($2 || ' days')::interval
      GROUP BY 1
      ORDER BY 1
      `,
      [linkId, days],
    );
    return rows.map((row) => ({ day: row.day, views: Number(row.views) }));
  }

  /** Cron: stamp revoked_at on links whose expiry has passed, so one check covers both. */
  async revokeExpired(): Promise<number> {
    const result = await this.repo.update(
      { revokedAt: IsNull(), expiresAt: LessThan(new Date()) },
      { revokedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /** Cron: an audit trail nobody prunes turns into a liability. */
  async purgeViewsOlderThan(days: number): Promise<number> {
    const result: unknown = await this.views.query(
      `DELETE FROM note_page_link_views WHERE viewed_at < now() - ($1 || ' days')::interval`,
      [days],
    );
    return Array.isArray(result) ? Number(result[1] ?? 0) : 0;
  }

  /** Written as raw SQL because "expires_at IS NULL OR in the future" has no operator form. */
  async countActiveByPage(notePageId: number): Promise<number> {
    return this.repo
      .createQueryBuilder('link')
      .where('link.note_page_id = :notePageId', { notePageId })
      .andWhere('link.revoked_at IS NULL')
      .andWhere('(link.expires_at IS NULL OR link.expires_at > now())')
      .getCount();
  }
}
