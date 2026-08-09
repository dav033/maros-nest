import { Injectable } from '@nestjs/common';
import { NotesRepository } from './repositories/notes.repository';
import { NoteTagsRepository } from './repositories/note-tags.repository';
import { NoteMapper } from './mappers/note.mapper';
import { NoteTreeService, MoveNoteResult } from './services/note-tree.service';
import { assertNoteVisible } from './services/note-access.util';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';
import { MoveNoteDto } from './dto/move-note.dto';
import { SetEntityDto } from './dto/set-entity.dto';
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
    private readonly noteTreeService: NoteTreeService,
    private readonly noteMapper: NoteMapper,
  ) {}

  /**
   * Stamps who edited the page. Only title/icon and content writes count as editing —
   * starring a note or dragging it in the tree is not an edit and leaves this alone.
   */
  private stampEditor(page: NotePage, userId?: number): void {
    if (userId === undefined) return;
    page.lastEditedById = userId;
  }

  /**
   * Re-reads a just-saved page so the response carries the joined lastEditedBy row.
   * The in-memory entity only holds the id that was just stamped, not the name the
   * client needs to render.
   */
  private async freshDetail(id: number, userId?: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    return this.noteMapper.toDetailDto(page, await this.favoriteIds(userId));
  }

  private async favoriteIds(userId?: number): Promise<Set<number>> {
    return this.notesRepository.findFavoriteIds(userId);
  }

  async getAllNotes(userId?: number): Promise<any[]> {
    const pages = await this.notesRepository.findAllActive(userId);
    const favorites = await this.favoriteIds(userId);
    return pages.map((page) => this.noteMapper.toSummaryDto(page, favorites));
  }

  async getFavorites(userId?: number): Promise<any[]> {
    const pages = await this.notesRepository.findFavorites(userId);
    const favorites = await this.favoriteIds(userId);
    return pages.map((page) => this.noteMapper.toSummaryDto(page, favorites));
  }

  async getTrash(userId?: number): Promise<any[]> {
    const pages = await this.notesRepository.findTrashedRoots(userId);
    const favorites = await this.favoriteIds(userId);
    return pages.map((page) => this.noteMapper.toSummaryDto(page, favorites));
  }

  async searchNotes(query: string, limit: number, userId?: number): Promise<any[]> {
    const rows = await this.notesRepository.search(query, limit, userId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      icon: row.icon,
      parentId: row.parent_id,
      updatedAt: row.updated_at,
      rank: Number(row.rank),
    }));
  }

  async getNoteById(id: number, userId?: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);
    return this.noteMapper.toDetailDto(page, await this.favoriteIds(userId));
  }

  // Entity-linked notes are never private, so no visibility check applies here.
  async getNotesByEntity(
    entityKind: string,
    entityId: number,
    userId?: number,
  ): Promise<any[]> {
    const pages = await this.notesRepository.findByEntity(entityKind, entityId);
    const favorites = await this.favoriteIds(userId);
    return pages.map((page) => this.noteMapper.toSummaryDto(page, favorites));
  }

  async createNote(dto: CreateNoteDto, userId?: number): Promise<any> {
    const page = new NotePage();
    page.kind = dto.kind ?? 'page';
    page.title = dto.title?.trim() || 'Untitled';
    page.icon = dto.icon;
    page.content = {};
    page.entityKind = dto.entityKind;
    page.entityId = dto.entityId;
    page.ownerId = userId;
    page.createdById = userId ?? null;
    this.stampEditor(page, userId);

    if (dto.parentId != null) {
      const parent = await this.notesRepository.findByIdActive(dto.parentId);
      if (!parent) throw new NoteNotFoundException(dto.parentId);
      assertNoteVisible(parent, userId);
      page.parent = parent;
    } else {
      page.parent = null;
    }

    const maxPosition = await this.notesRepository.getMaxPositionUnderParent(
      dto.parentId ?? null,
    );
    page.position = maxPosition + POSITION_STEP;

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, userId);
  }

  async updateNote(id: number, dto: UpdateNoteDto, userId?: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);

    if (dto.title !== undefined) page.title = dto.title.trim() || 'Untitled';
    if (dto.icon !== undefined) page.icon = dto.icon;
    this.stampEditor(page, userId);

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, userId);
  }

  async updateNoteContent(
    id: number,
    dto: UpdateNoteContentDto,
    userId?: number,
  ): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);
    if (page.kind === 'folder') throw new NoteFolderHasNoContentException(id);

    if (
      dto.expectedUpdatedAt !== undefined &&
      page.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()
    ) {
      throw new NotePageStaleContentException(id);
    }

    page.content = dto.content;
    page.contentText = extractPlainTextFromTipTapDoc(dto.content);
    this.stampEditor(page, userId);

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, userId);
  }

  /**
   * Links the note to a lead/project/contact/company, or clears the link when
   * entityKind is null.
   *
   * Unlinking has a privacy edge: visibility reads as "entity-linked, or unowned, or
   * mine" (see note-access.util.ts), so dropping the link on a note owned by someone
   * else would turn it into that person's private note and hide it from the actor who
   * just edited it. Clearing ownerId in that case keeps the note shared — unlinking
   * must never silently hand a note to one person.
   */
  async setEntityLink(id: number, dto: SetEntityDto, userId?: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);

    if (dto.entityKind === null) {
      page.entityKind = null;
      page.entityId = null;
      if (userId !== undefined && page.ownerId != null && page.ownerId !== userId) {
        page.ownerId = null;
      }
    } else {
      page.entityKind = dto.entityKind;
      page.entityId = dto.entityId;
    }

    const saved = await this.notesRepository.save(page);
    return this.freshDetail(saved.id, userId);
  }

  async moveNote(id: number, dto: MoveNoteDto, userId?: number): Promise<MoveNoteResult> {
    return this.noteTreeService.move(
      id,
      dto.parentId ?? null,
      userId,
      dto.beforeId,
      dto.afterId,
    );
  }

  /**
   * Favorites are per user, so this writes the join table rather than a column on the
   * page — and does nothing for the MCP shared-token context, which has no user to
   * star anything for.
   */
  async setFavorite(id: number, isFavorite: boolean, userId?: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);

    if (userId !== undefined) {
      if (isFavorite) await this.notesRepository.addFavorite(id, userId);
      else await this.notesRepository.removeFavorite(id, userId);
    }

    return this.noteMapper.toSummaryDto(page, await this.favoriteIds(userId));
  }

  async setTags(id: number, tagIds: number[], userId?: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);
    page.tags = await this.noteTagsRepository.findByIds(tagIds);
    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toSummaryDto(saved, await this.favoriteIds(userId));
  }

  async trashNote(id: number, userId?: number): Promise<void> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);
    await this.notesRepository.trashSubtree(id);
  }

  async restoreNote(id: number, userId?: number): Promise<any> {
    const page = await this.notesRepository.findById(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);
    await this.notesRepository.restoreSubtree(id);
    return this.getNoteById(id, userId);
  }

  async purgeNote(id: number, userId?: number): Promise<void> {
    const page = await this.notesRepository.findById(id);
    if (!page) throw new NoteNotFoundException(id);
    assertNoteVisible(page, userId);
    await this.notesRepository.purge(id);
  }
}
