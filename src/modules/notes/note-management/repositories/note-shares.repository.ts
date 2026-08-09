import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotePageShare,
  NoteShareAccess,
  NoteShareSubjectType,
} from '../../../../entities/note-page-share.entity';

/** A grant that applies to a page, with the page it was actually written on. */
export interface EffectiveGrantRow {
  access: NoteShareAccess;
  /** The page carrying the grant — equal to the queried page, or an ancestor. */
  grantedOnPageId: number;
  grantedOnTitle: string;
}

/** A grant plus the user it points at, for the share dialog's people list. */
export interface ShareWithSubjectRow {
  id: number;
  notePageId: number;
  subjectType: NoteShareSubjectType;
  subjectId: number;
  access: NoteShareAccess;
  expiresAt: Date | null;
  createdAt: Date;
  grantedOnTitle: string;
  subjectName: string | null;
  subjectEmail: string | null;
  subjectPicture: string | null;
}

/**
 * Grants are stored on one page but apply to its whole subtree, so almost every read
 * here walks *up* the tree with a recursive CTE. Walking down instead (expanding a
 * grant to its descendants) is the shape the list queries need, and lives in
 * NotesRepository.visibleSubquery.
 */
@Injectable()
export class NoteSharesRepository {
  constructor(
    @InjectRepository(NotePageShare)
    private readonly repo: Repository<NotePageShare>,
  ) {}

  /**
   * Every non-expired grant that reaches `pageId` for this user or their role,
   * including grants inherited from any ancestor. Callers pick the strongest.
   */
  async findEffectiveGrants(
    pageId: number,
    userId: number,
    roleId: number | null,
  ): Promise<EffectiveGrantRow[]> {
    const rows: Array<{
      access: NoteShareAccess;
      granted_on_page_id: number;
      granted_on_title: string;
    }> = await this.repo.query(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, title FROM note_pages WHERE id = $1
        UNION ALL
        SELECT p.id, p.parent_id, p.title
        FROM note_pages p
        JOIN ancestors a ON p.id = a.parent_id
      )
      SELECT s.access,
             a.id    AS granted_on_page_id,
             a.title AS granted_on_title
      FROM note_page_shares s
      JOIN ancestors a ON a.id = s.note_page_id
      WHERE (
              (s.subject_type = 'user' AND s.subject_id = $2)
           OR (s.subject_type = 'role' AND $3::int IS NOT NULL AND s.subject_id = $3)
            )
        AND (s.expires_at IS NULL OR s.expires_at > now())
      `,
      [pageId, userId, roleId],
    );

    return rows.map((row) => ({
      access: row.access,
      grantedOnPageId: row.granted_on_page_id,
      grantedOnTitle: row.granted_on_title,
    }));
  }

  /**
   * Everyone who can reach this page through a grant, direct or inherited, for the
   * share dialog. The user join is a LEFT JOIN because role grants have no user row.
   */
  async findSharesForPage(pageId: number): Promise<ShareWithSubjectRow[]> {
    const rows: Array<{
      id: number;
      note_page_id: number;
      subject_type: NoteShareSubjectType;
      subject_id: number;
      access: NoteShareAccess;
      expires_at: Date | null;
      created_at: Date;
      granted_on_title: string;
      subject_name: string | null;
      subject_email: string | null;
      subject_picture: string | null;
    }> = await this.repo.query(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, title FROM note_pages WHERE id = $1
        UNION ALL
        SELECT p.id, p.parent_id, p.title
        FROM note_pages p
        JOIN ancestors a ON p.id = a.parent_id
      )
      SELECT s.id, s.note_page_id, s.subject_type, s.subject_id, s.access,
             s.expires_at, s.created_at,
             a.title AS granted_on_title,
             u.name    AS subject_name,
             u.email   AS subject_email,
             u.picture AS subject_picture
      FROM note_page_shares s
      JOIN ancestors a ON a.id = s.note_page_id
      LEFT JOIN users u ON s.subject_type = 'user' AND u.id = s.subject_id
      LEFT JOIN roles r ON s.subject_type = 'role' AND r.id = s.subject_id
      WHERE s.subject_type = 'user' OR r.id IS NOT NULL
      ORDER BY (s.note_page_id = $1) DESC, s.created_at ASC
      `,
      [pageId],
    );

    return rows.map((row) => ({
      id: row.id,
      notePageId: row.note_page_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      access: row.access,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      grantedOnTitle: row.granted_on_title,
      subjectName: row.subject_name,
      subjectEmail: row.subject_email,
      subjectPicture: row.subject_picture,
    }));
  }

  async findById(id: number): Promise<NotePageShare | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Re-granting to the same subject overwrites the level rather than failing on the
   * unique index — "share with Ana as editor" must work whether or not Ana already had
   * viewer access.
   */
  async upsert(share: {
    notePageId: number;
    subjectType: NoteShareSubjectType;
    subjectId: number;
    access: NoteShareAccess;
    grantedById: number | null;
    expiresAt: Date | null;
  }): Promise<NotePageShare> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values(share)
      .orUpdate(['access', 'expires_at', 'granted_by_id'], [
        'note_page_id',
        'subject_type',
        'subject_id',
      ])
      .execute();

    const saved = await this.repo.findOne({
      where: {
        notePageId: share.notePageId,
        subjectType: share.subjectType,
        subjectId: share.subjectId,
      },
    });
    // The row was just inserted or updated in the same statement, so this cannot miss.
    return saved!;
  }

  async update(
    id: number,
    changes: { access?: NoteShareAccess; expiresAt?: Date | null },
  ): Promise<void> {
    await this.repo.update(id, changes);
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * Roots of the subtrees the user reaches only through a grant. The tree UI expands
   * from these, so returning descendants too would show the same branch twice.
   */
  async findGrantedRootIds(userId: number, roleId: number | null): Promise<number[]> {
    const rows: Array<{ note_page_id: number }> = await this.repo.query(
      `
      SELECT DISTINCT s.note_page_id
      FROM note_page_shares s
      JOIN note_pages p ON p.id = s.note_page_id
      WHERE (
              (s.subject_type = 'user' AND s.subject_id = $1)
           OR (s.subject_type = 'role' AND $2::int IS NOT NULL AND s.subject_id = $2)
            )
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND p.deleted_at IS NULL
      `,
      [userId, roleId],
    );
    return rows.map((row) => row.note_page_id);
  }

  /**
   * Which of these pages carry at least one live grant, for the "shared" badge in the
   * tree. Direct grants only — an inherited one belongs to the folder that owns it, and
   * badging every descendant would make a single share look like a dozen.
   */
  async findSharedPageIds(pageIds: number[]): Promise<Set<number>> {
    if (pageIds.length === 0) return new Set();
    const rows: Array<{ note_page_id: number }> = await this.repo.query(
      `
      SELECT DISTINCT note_page_id
      FROM note_page_shares
      WHERE note_page_id = ANY($1::int[])
        AND (expires_at IS NULL OR expires_at > now())
      `,
      [pageIds],
    );
    return new Set(rows.map((row) => row.note_page_id));
  }

  /** Drops grants pointing at a user or role that no longer exists. Used by the cron. */
  async deleteOrphanedSubjects(): Promise<number> {
    const result: unknown = await this.repo.query(
      `
      DELETE FROM note_page_shares s
      WHERE (s.subject_type = 'user' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.subject_id))
         OR (s.subject_type = 'role' AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = s.subject_id))
      `,
    );
    // node-postgres returns [rows, rowCount] for DELETE through TypeORM's raw query.
    return Array.isArray(result) ? Number(result[1] ?? 0) : 0;
  }
}
