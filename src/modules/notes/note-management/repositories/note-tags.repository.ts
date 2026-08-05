import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NoteTag } from '../../../../entities/note-tag.entity';

@Injectable()
export class NoteTagsRepository {
  constructor(
    @InjectRepository(NoteTag)
    private readonly repo: Repository<NoteTag>,
  ) {}

  async findAll(): Promise<NoteTag[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<NoteTag | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIds(ids: number[]): Promise<NoteTag[]> {
    if (ids.length === 0) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  async findByNameCaseInsensitive(name: string): Promise<NoteTag | null> {
    return this.repo
      .createQueryBuilder('tag')
      .where('LOWER(tag.name) = LOWER(:name)', { name })
      .getOne();
  }

  async save(tag: NoteTag): Promise<NoteTag> {
    return this.repo.save(tag);
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
