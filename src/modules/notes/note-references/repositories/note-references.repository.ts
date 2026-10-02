import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { NotePage } from '../../../../entities/note-page.entity';
import {
  NoteReference,
  type NoteReferenceKind,
  type NoteReferenceOrigin,
} from '../../../../entities/note-reference.entity';
import { NotesRepository } from '../../note-management/repositories/notes.repository';
import type { NoteActor } from '../../note-management/services/note-access.service';

/** A reference as it is about to be written: no id, no timestamps, just the pointer. */
export interface NoteReferenceDraft {
  targetKind: NoteReferenceKind;
  targetId: number;
  label: string | null;
}

/** One row of the reverse query: the note doing the pointing, plus how it points. */
export interface ReferencingPage {
  page: NotePage;
  origins: NoteReferenceOrigin[];
}

@Injectable()
export class NoteReferencesRepository {
  constructor(
    @InjectRepository(NoteReference)
    private readonly repo: Repository<NoteReference>,
    @InjectRepository(NotePage)
    private readonly pages: Repository<NotePage>,
    private readonly dataSource: DataSource,
  ) {}

  async findByPage(pageId: number): Promise<NoteReference[]> {
    return this.repo.find({
      where: { notePageId: pageId },
      order: { origin: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Rewrites the page's inline references to exactly what its document now says.
   *
   * Delete-then-insert rather than a diff: the document is the source of truth, the row
   * count is a handful, and a diff would have to decide what to do about a label that
   * changed — which is the same insert either way. In one transaction so a failed save
   * cannot leave a note with no inline references at all.
   *
   * Pinned relations are untouched; they are not derived from the document.
   */
  async replaceInline(
    pageId: number,
    drafts: NoteReferenceDraft[],
    actorId?: number | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NoteReference);
      await repo.delete({ notePageId: pageId, origin: 'inline' });
      if (drafts.length === 0) return;

      await repo.insert(
        drafts.map((draft) => ({
          notePageId: pageId,
          targetKind: draft.targetKind,
          targetId: draft.targetId,
          origin: 'inline' as const,
          labelSnapshot: draft.label,
          createdById: actorId ?? null,
        })),
      );
    });
  }

  /** Idempotent: pinning the same record twice is the same single relation. */
  async addRelation(
    pageId: number,
    draft: NoteReferenceDraft,
    actorId?: number | null,
  ): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(NoteReference)
      .values({
        notePageId: pageId,
        targetKind: draft.targetKind,
        targetId: draft.targetId,
        origin: 'relation',
        labelSnapshot: draft.label,
        createdById: actorId ?? null,
      })
      .orIgnore()
      .execute();
  }

  async removeRelation(
    pageId: number,
    targetKind: NoteReferenceKind,
    targetId: number,
  ): Promise<void> {
    await this.repo.delete({ notePageId: pageId, targetKind, targetId, origin: 'relation' });
  }

  /**
   * The reverse question: which notes point at this record.
   *
   * Filtered by the same visibility rule as every other note list (see
   * NotesRepository.visibleCondition) — a backlink must not be a way to learn that a
   * private note exists, let alone read its title.
   *
   * Two queries rather than one join, deliberately. A note can reference the same record
   * under both origins, so a join multiplies it; and the obvious fix — reading `origin`
   * off the raw rows of getRawAndEntities — does not work, because TypeORM groups raw rows
   * by the primary alias id when building entities. The two arrays then have different
   * lengths and zipping them by index attributes one page's origins to another. A subquery
   * for the pages plus one small lookup for their origins has no such trap.
   */
  async findPagesReferencing(
    targetKind: NoteReferenceKind,
    targetId: number,
    actor?: NoteActor,
    options: { origins?: NoteReferenceOrigin[]; excludePageId?: number } = {},
  ): Promise<ReferencingPage[]> {
    const origins = options.origins?.length ? options.origins : undefined;

    const qb = this.pages
      .createQueryBuilder('page')
      .leftJoinAndSelect('page.parent', 'parent')
      .leftJoinAndSelect('page.lastEditedBy', 'lastEditedBy')
      .where('page.deleted_at IS NULL')
      .andWhere(
        `page.id IN (
           SELECT ref.note_page_id
           FROM note_references ref
           WHERE ref.target_kind = :targetKind
             AND ref.target_id = :targetId
             ${origins ? 'AND ref.origin IN (:...origins)' : ''}
         )`,
        origins ? { targetKind, targetId, origins } : { targetKind, targetId },
      )
      .orderBy('page.updated_at', 'DESC')
      .addOrderBy('page.id', 'DESC');

    if (options.excludePageId != null) {
      qb.andWhere('page.id != :excludePageId', { excludePageId: options.excludePageId });
    }
    if (actor) {
      qb.andWhere(NotesRepository.visibleCondition(actor.roleId), {
        userId: actor.id,
        roleId: actor.roleId,
      });
    }

    const pages = await qb.getMany();
    if (pages.length === 0) return [];

    const rows = await this.repo.find({
      where: {
        notePageId: In(pages.map((page) => page.id)),
        targetKind,
        targetId,
        ...(origins ? { origin: In(origins) } : {}),
      },
    });

    const originsByPage = new Map<number, NoteReferenceOrigin[]>();
    for (const row of rows) {
      const bucket = originsByPage.get(row.notePageId) ?? [];
      if (!bucket.includes(row.origin)) bucket.push(row.origin);
      originsByPage.set(row.notePageId, bucket);
    }

    return pages.map((page) => ({
      page,
      // Defaulting to 'inline' would be a guess; a page in this list always has at least
      // one row, so an empty array only happens if one was deleted between the two
      // queries, and an empty array renders as "linked, no quotable line".
      origins: originsByPage.get(page.id) ?? [],
    }));
  }
}
