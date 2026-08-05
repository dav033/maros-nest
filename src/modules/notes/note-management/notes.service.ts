import { Injectable } from '@nestjs/common';
import { NotesRepository } from './repositories/notes.repository';
import { NoteTagsRepository } from './repositories/note-tags.repository';
import { NoteMapper } from './mappers/note.mapper';
import { NoteTreeService, MoveNoteResult } from './services/note-tree.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';
import { MoveNoteDto } from './dto/move-note.dto';
import { NotePage } from '../../../entities/note-page.entity';
import {
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

  async getAllNotes(): Promise<any[]> {
    const pages = await this.notesRepository.findAllActive();
    return pages.map((page) => this.noteMapper.toSummaryDto(page));
  }

  async getFavorites(): Promise<any[]> {
    const pages = await this.notesRepository.findFavorites();
    return pages.map((page) => this.noteMapper.toSummaryDto(page));
  }

  async getTrash(): Promise<any[]> {
    const pages = await this.notesRepository.findTrashedRoots();
    return pages.map((page) => this.noteMapper.toSummaryDto(page));
  }

  async searchNotes(query: string, limit: number): Promise<any[]> {
    const rows = await this.notesRepository.search(query, limit);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      icon: row.icon,
      parentId: row.parent_id,
      updatedAt: row.updated_at,
      rank: Number(row.rank),
    }));
  }

  async getNoteById(id: number): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    return this.noteMapper.toDetailDto(page);
  }

  async getNotesByEntity(entityKind: string, entityId: number): Promise<any[]> {
    const pages = await this.notesRepository.findByEntity(entityKind, entityId);
    return pages.map((page) => this.noteMapper.toSummaryDto(page));
  }

  async createNote(dto: CreateNoteDto): Promise<any> {
    const page = new NotePage();
    page.title = dto.title?.trim() || 'Untitled';
    page.icon = dto.icon;
    page.content = {};
    page.entityKind = dto.entityKind;
    page.entityId = dto.entityId;

    if (dto.parentId != null) {
      const parent = await this.notesRepository.findByIdActive(dto.parentId);
      if (!parent) throw new NoteNotFoundException(dto.parentId);
      page.parent = parent;
    } else {
      page.parent = null;
    }

    const maxPosition = await this.notesRepository.getMaxPositionUnderParent(
      dto.parentId ?? null,
    );
    page.position = maxPosition + POSITION_STEP;

    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toDetailDto(saved);
  }

  async updateNote(id: number, dto: UpdateNoteDto): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);

    if (dto.title !== undefined) page.title = dto.title.trim() || 'Untitled';
    if (dto.icon !== undefined) page.icon = dto.icon;

    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toDetailDto(saved);
  }

  async updateNoteContent(id: number, dto: UpdateNoteContentDto): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);

    if (
      dto.expectedUpdatedAt !== undefined &&
      page.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()
    ) {
      throw new NotePageStaleContentException(id);
    }

    page.content = dto.content;
    page.contentText = extractPlainTextFromTipTapDoc(dto.content);

    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toDetailDto(saved);
  }

  async moveNote(id: number, dto: MoveNoteDto): Promise<MoveNoteResult> {
    return this.noteTreeService.move(id, dto.parentId ?? null, dto.beforeId, dto.afterId);
  }

  async setFavorite(id: number, isFavorite: boolean): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    page.isFavorite = isFavorite;
    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toSummaryDto(saved);
  }

  async setTags(id: number, tagIds: number[]): Promise<any> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    page.tags = await this.noteTagsRepository.findByIds(tagIds);
    const saved = await this.notesRepository.save(page);
    return this.noteMapper.toSummaryDto(saved);
  }

  async trashNote(id: number): Promise<void> {
    const page = await this.notesRepository.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.notesRepository.trashSubtree(id);
  }

  async restoreNote(id: number): Promise<any> {
    const page = await this.notesRepository.findById(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.notesRepository.restoreSubtree(id);
    return this.getNoteById(id);
  }

  async purgeNote(id: number): Promise<void> {
    const page = await this.notesRepository.findById(id);
    if (!page) throw new NoteNotFoundException(id);
    await this.notesRepository.purge(id);
  }
}
