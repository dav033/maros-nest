import { Injectable } from '@nestjs/common';
import { NoteTagsRepository } from '../repositories/note-tags.repository';
import { CreateTagDto } from '../dto/create-tag.dto';
import { UpdateTagDto } from '../dto/update-tag.dto';
import { NoteTag } from '../../../../entities/note-tag.entity';
import {
  NoteTagNotFoundException,
  NoteTagNameConflictException,
} from '../../../../common/exceptions';

@Injectable()
export class NoteTagsService {
  constructor(private readonly noteTagsRepository: NoteTagsRepository) {}

  private toDto(tag: NoteTag) {
    return { id: tag.id, name: tag.name, color: tag.color };
  }

  async listTags(): Promise<any[]> {
    const tags = await this.noteTagsRepository.findAll();
    return tags.map((tag) => this.toDto(tag));
  }

  async createTag(dto: CreateTagDto): Promise<any> {
    const existing = await this.noteTagsRepository.findByNameCaseInsensitive(dto.name);
    if (existing) throw new NoteTagNameConflictException(dto.name);

    const tag = new NoteTag();
    tag.name = dto.name.trim();
    tag.color = dto.color ?? 'neutral';
    const saved = await this.noteTagsRepository.save(tag);
    return this.toDto(saved);
  }

  async updateTag(id: number, dto: UpdateTagDto): Promise<any> {
    const tag = await this.noteTagsRepository.findById(id);
    if (!tag) throw new NoteTagNotFoundException(id);

    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== tag.name.toLowerCase()) {
      const existing = await this.noteTagsRepository.findByNameCaseInsensitive(dto.name);
      if (existing) throw new NoteTagNameConflictException(dto.name);
      tag.name = dto.name.trim();
    }
    if (dto.color !== undefined) tag.color = dto.color;

    const saved = await this.noteTagsRepository.save(tag);
    return this.toDto(saved);
  }

  async deleteTag(id: number): Promise<void> {
    const tag = await this.noteTagsRepository.findById(id);
    if (!tag) throw new NoteTagNotFoundException(id);
    await this.noteTagsRepository.delete(id);
  }
}
