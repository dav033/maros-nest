import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotePage } from '../../entities/note-page.entity';
import { NotePageFavorite } from '../../entities/note-page-favorite.entity';
import { NoteTag } from '../../entities/note-tag.entity';
import { NotesRepository } from './note-management/repositories/notes.repository';
import { NoteTagsRepository } from './note-management/repositories/note-tags.repository';
import { NotesService } from './note-management/notes.service';
import { NoteTagsService } from './note-management/services/note-tags.service';
import { NoteTreeService } from './note-management/services/note-tree.service';
import { NotesController } from './note-management/notes.controller';
import { NoteMapper } from './note-management/mappers/note.mapper';

@Module({
  imports: [TypeOrmModule.forFeature([NotePage, NotePageFavorite, NoteTag])],
  controllers: [NotesController],
  providers: [
    NotesRepository,
    NoteTagsRepository,
    NotesService,
    NoteTagsService,
    NoteTreeService,
    NoteMapper,
  ],
  exports: [NotesRepository, NotesService, NoteTagsService],
})
export class NotesModule {}
