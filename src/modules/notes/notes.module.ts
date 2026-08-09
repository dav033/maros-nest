import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotePage } from '../../entities/note-page.entity';
import { NotePageFavorite } from '../../entities/note-page-favorite.entity';
import { NotePageShare } from '../../entities/note-page-share.entity';
import { NotePageLink } from '../../entities/note-page-link.entity';
import { NotePageLinkView } from '../../entities/note-page-link-view.entity';
import { NoteTag } from '../../entities/note-tag.entity';
import { S3Module } from '../s3/s3.module';
import { NotesRepository } from './note-management/repositories/notes.repository';
import { NoteTagsRepository } from './note-management/repositories/note-tags.repository';
import { NoteSharesRepository } from './note-management/repositories/note-shares.repository';
import { NoteLinksRepository } from './note-management/repositories/note-links.repository';
import { NotesService } from './note-management/notes.service';
import { NoteTagsService } from './note-management/services/note-tags.service';
import { NoteTreeService } from './note-management/services/note-tree.service';
import { NoteAccessService } from './note-management/services/note-access.service';
import { NotesController } from './note-management/notes.controller';
import { NoteMapper } from './note-management/mappers/note.mapper';
import { NoteSharingService } from './note-sharing/note-sharing.service';
import { NotePublicService } from './note-sharing/note-public.service';
import { NotePublicController } from './note-sharing/note-public.controller';
import { NoteShareMapper } from './note-sharing/mappers/note-share.mapper';
import { NoteShareLinkGuard } from './note-sharing/guards/note-share-link.guard';
import { PublicRateLimitGuard } from './note-sharing/guards/public-rate-limit.guard';
import { NoteSharingMaintenanceCron } from './note-sharing/note-sharing-maintenance.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotePage,
      NotePageFavorite,
      NotePageShare,
      NotePageLink,
      NotePageLinkView,
      NoteTag,
    ]),
    // The public reader signs image URLs through S3Service rather than handing out
    // bucket credentials of its own.
    S3Module,
    // Caches the per-link set of image keys, so a note with twenty images does not
    // re-read its document twenty times.
    CacheModule.register(),
  ],
  controllers: [NotesController, NotePublicController],
  providers: [
    NotesRepository,
    NoteTagsRepository,
    NoteSharesRepository,
    NoteLinksRepository,
    NotesService,
    NoteTagsService,
    NoteTreeService,
    NoteAccessService,
    NoteMapper,
    NoteSharingService,
    NotePublicService,
    NoteShareMapper,
    NoteShareLinkGuard,
    PublicRateLimitGuard,
    NoteSharingMaintenanceCron,
  ],
  exports: [NotesRepository, NotesService, NoteTagsService, NoteAccessService],
})
export class NotesModule {}
