import { Injectable } from '@nestjs/common';
import { NotesRepository } from './repositories/notes.repository';
import { NoteTagsRepository } from './repositories/note-tags.repository';
import { NoteLinksRepository } from './repositories/note-links.repository';
import { NoteSharesRepository } from './repositories/note-shares.repository';
import { NoteMapper, NoteListBadges } from './mappers/note.mapper';
import { NoteTreeService, MoveNoteResult } from './services/note-tree.service';
import { NoteAccessService, NoteActor } from './services/note-access.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';
import { MoveNoteDto } from './dto/move-note.dto';
import { SetEntityDto } from './dto/set-entity.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { NotePage } from '../../../entities/note-page.entity';
import {
  NoteFolderHasNoContentException,
  NoteNotFoundException,
  NotePageStaleContentException,
} from '../../../common/exceptions';
import { extractPlainTextFromTipTapDoc } from '../../../common/utils/tiptap-text.util';

const POSITION_STEP = 1000;

@Injectable()
export class NotesService {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly noteTagsRepository: NoteTagsRepository,
    private readonly noteSharesRepository: NoteSharesRepository,
    private readonly noteLinksRepository: NoteLinksRepository,
    private readonly noteTreeService: NoteTreeService,
    private readonly noteAccess: NoteAccessService,
    private readonly noteMapper: NoteMapper,
  ) {}

  /**
   * Stamps who edited the page. Only title/icon and content writes count as editing —
   * starring a note or dragging it in the tree is not an edit and leaves this alone.
   */
  private stampEditor(page: NotePage, actor?: NoteActor): void {
    if (!actor) return;
    page.lastEditedById = actor.id;
  }

  /**
   * Re-reads a just-saved page so the response carries the joined lastEditedBy row.
   * The in-memory entity only holds the id that was just stamped, not the name the
   * client needs to render.
   */
  private async freshDetail(id: number, actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    return this.noteMapper.toDetailDto(
      page,
      await this.favoriteIds(actor),
      await this.noteAccess.accessFor(page, actor),
    );
  }

  private async favoriteIds(actor?: NoteActor): Promise<Set<number>> {
    return this.notesRepository.findFavoriteIds(actor);
  }

  /**
   * Two set queries so a whole tree can be rendered with "shared" and "published"
   * badges without asking per row. Cheap: both are index-only scans over small tables.
   */
  private async listBadges(pageIds: number[]): Promise<NoteListBadges> {
    if (pageIds.length === 0) {
      return { sharedIds: new Set(), publishedIds: new Set() };
    }
    const [sharedIds, publishedIds] = await Promise.all([
      this.noteSharesRepository.findSharedPageIds(pageIds),
      this.noteLinksRepository.findPublishedPageIds(pageIds),
    ]);
    return { sharedIds, publishedIds };
  }

  private async toSummaryList(pages: NotePage[], actor?: NoteActor): Promise<any[]> {
    const favorites = await this.favoriteIds(actor);
    const badges = await this.listBadges(pages.map((page) => page.id));
    return pages.map((page) => this.noteMapper.toSummaryDto(page, favorites, badges));
  }

  async getAllNotes(actor?: NoteActor): Promise<any[]> {
    return this.toSummaryList(await this.notesRepository.findAllActive(actor), actor);
  }

  async getFavorites(actor?: NoteActor): Promise<any[]> {
    return this.toSummaryList(await this.notesRepository.findFavorites(actor), actor);
  }

  async getTrash(actor?: NoteActor): Promise<any[]> {
    return this.toSummaryList(await this.notesRepository.findTrashedRoots(actor), actor);
  }

  /** Notes reachable only through a grant — nothing the caller could already see. */
  async getSharedWithMe(actor?: NoteActor): Promise<any[]> {
    if (!actor) return [];
    return this.toSummaryList(await this.notesRepository.findSharedWithMe(actor), actor);
  }

  async searchNotes(query: string, limit: number, actor?: NoteActor): Promise<any[]> {
    const rows = await this.notesRepository.search(query, limit, actor);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      icon: row.icon,
      parentId: row.parent_id,
      updatedAt: row.updated_at,
      rank: Number(row.rank),
    }));
  }

  async getNoteById(id: number, actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    const access = await this.noteAccess.assertCanRead(page, actor);
    return this.noteMapper.toDetailDto(page, await this.favoriteIds(actor), access);
  }

  /** Loads a page for a caller who already holds the required access. */
  async loadForAccess(
    id: number,
    required: 'viewer' | 'editor' | 'owner',
    actor?: NoteActor,
  ): Promise<NotePage> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assert(page, required, actor);
    return page;
  }

  async getNotesByEntity(
    entityKind: string,
    entityId: number,
    actor?: NoteActor,
  ): Promise<any[]> {
    const pages = await this.notesRepository.findByEntity(entityKind, entityId, actor);
    return this.toSummaryList(pages, actor);
  }

  /**
   * A standalone note starts private to its creator; one attached to a CRM entity
   * starts visible to the team, because the whole point of attaching it is that whoever
   * works that lead sees it. Both were the previous implicit behaviour — now they are
   * just a default the owner can change.
   */
  async createNote(dto: CreateNoteDto, actor?: NoteActor): Promise<any> {
    const page = new NotePage();
    page.kind = dto.kind ?? 'page';
    page.title = dto.title?.trim() || 'Untitled';
    page.icon = dto.icon;
    page.content = {};
    page.entityKind = dto.entityKind;
    page.entityId = dto.entityId;
    page.ownerId = actor?.id ?? null;
    page.createdById = actor?.id ?? null;
    page.visibility = dto.entityKind ? 'team' : 'private';
    this.stampEditor(page, actor);

    if (dto.parentId != null) {
      const parent = await this.notesRepository.findByIdActive(dto.parentId);
      if (!parent) throw new NoteNotFoundException(dto.parentId);
      await this.noteAccess.assertCanEdit(parent, actor);
      page.parent = parent;
      // A child of a shared folder must be reachable by the people that folder was
      // shared with, or the grant would quietly stop covering new pages. Grants are
      // inherited downward, so the child only has to be non-private for that to work.
      if (parent.visibility === 'team') page.visibility = 'team';
    } else {
      page.parent = null;
    }

    const maxPosition = await this.notesRepository.getMaxPositionUnderParent(
      dto.parentId ?? null,
    );
    page.position = maxPosition + POSITION_STEP;

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, actor);
  }

  async updateNote(id: number, dto: UpdateNoteDto, actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanEdit(page, actor);

    if (dto.title !== undefined) page.title = dto.title.trim() || 'Untitled';
    if (dto.icon !== undefined) page.icon = dto.icon;
    this.stampEditor(page, actor);

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, actor);
  }

  async updateNoteContent(
    id: number,
    dto: UpdateNoteContentDto,
    actor?: NoteActor,
  ): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanEdit(page, actor);
    if (page.kind === 'folder') throw new NoteFolderHasNoContentException(id);

    if (
      dto.expectedUpdatedAt !== undefined &&
      page.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()
    ) {
      throw new NotePageStaleContentException(id);
    }

    page.content = dto.content;
    page.contentText = extractPlainTextFromTipTapDoc(dto.content);
    this.stampEditor(page, actor);

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, actor);
  }

  /**
   * Only the owner decides who can reach their note.
   *
   * Making an ownerless legacy note private also claims it: with no owner, `private`
   * would mean nobody at all could open it — including whoever just set it. Ownership
   * is what makes the switch reversible.
   */
  async setVisibility(
    id: number,
    dto: SetVisibilityDto,
    actor?: NoteActor,
  ): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanManage(page, actor);

    page.visibility = dto.visibility;
    if (dto.visibility === 'private' && page.ownerId == null && actor) {
      page.ownerId = actor.id;
    }

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, actor);
  }

  /**
   * Links the note to a lead/project/contact/company, or clears the link when
   * entityKind is null.
   *
   * Unlinking used to have to clear owner_id, because privacy was inferred from
   * "standalone and owned" and dropping the link would have turned the note into
   * someone else's private page. `visibility` is an explicit column since
   * db/notes-sharing.sql, so the link and who can read the note are now independent and
   * that workaround is gone.
   */
  async setEntityLink(id: number, dto: SetEntityDto, actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanEdit(page, actor);

    if (dto.entityKind === null) {
      page.entityKind = null;
      page.entityId = null;
    } else {
      page.entityKind = dto.entityKind;
      page.entityId = dto.entityId;
    }

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, actor);
  }

  async moveNote(
    id: number,
    dto: MoveNoteDto,
    actor?: NoteActor,
  ): Promise<MoveNoteResult> {
    return this.noteTreeService.move(
      id,
      dto.parentId ?? null,
      actor,
      dto.beforeId,
      dto.afterId,
    );
  }

  /**
   * Favorites are per user, so this writes the join table rather than a column on the
   * page — and does nothing for the MCP shared-token context, which has no user to
   * star anything for.
   */
  async setFavorite(id: number, isFavorite: boolean, actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanRead(page, actor);

    if (actor) {
      if (isFavorite) await this.notesRepository.addFavorite(id, actor.id);
      else await this.notesRepository.removeFavorite(id, actor.id);
    }

    return this.noteMapper.toSummaryDto(page, await this.favoriteIds(actor));
  }

  async setTags(id: number, tagIds: number[], actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanEdit(page, actor);
    page.tags = await this.noteTagsRepository.findByIds(tagIds);
    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toSummaryDto(saved, await this.favoriteIds(actor));
  }

  /**
   * Trashing takes the subtree out of every list — and, because the public guard
   * requires deleted_at IS NULL, out of any share link too. The link is not revoked:
   * restoring brings it back, and trashing something by accident must not burn a URL
   * that is already out in the world.
   */
  async trashNote(id: number, actor?: NoteActor): Promise<void> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanEdit(page, actor);
    await this.notesRepository.trashSubtree(id);
  }

  async restoreNote(id: number, actor?: NoteActor): Promise<any> {
    const page = await this.notesRepository.findById(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanEdit(page, actor);
    await this.notesRepository.restoreSubtree(id);
    return this.getNoteById(id, actor);
  }

  /** Permanent deletion. Shares, links and their view history cascade away with it. */
  async purgeNote(id: number, actor?: NoteActor): Promise<void> {
    const page = await this.notesRepository.findById(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.noteAccess.assertCanManage(page, actor);
    await this.notesRepository.purge(id);
  }
}
