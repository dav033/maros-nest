import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { SignJWT } from 'jose';
import { NotePageLink } from '../../../entities/note-page-link.entity';
import { NotePage } from '../../../entities/note-page.entity';
import {
  NoteShareLinkNotFoundException,
  NoteShareLinkPasswordInvalidException,
} from '../../../common/exceptions';
import { S3Service } from '../../s3/services/s3.service';
import { NotesRepository } from '../note-management/repositories/notes.repository';
import { NoteLinksRepository } from '../note-management/repositories/note-links.repository';
import { NoteMapper } from '../note-management/mappers/note.mapper';
import { collectImageKeys } from './services/note-image-keys.util';
import { hashVisitorIp, verifySharePassword } from './services/share-token.util';
import { SHARE_UNLOCK_TTL_SECONDS } from './guards/share-link-context';
import { executeInBackground } from '../../../common/utils/background-tasks.util';

/** Presigned image URLs are short-lived: a reader loads them immediately or not at all. */
const IMAGE_URL_TTL_SECONDS = 300;

/** The key set rarely changes but is read once per <img>; 60s is plenty. */
const KEY_SET_CACHE_TTL_MS = 60_000;

@Injectable()
export class NotePublicService {
  private readonly logger = new Logger(NotePublicService.name);

  constructor(
    private readonly notes: NotesRepository,
    private readonly links: NoteLinksRepository,
    private readonly mapper: NoteMapper,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * The note a link points at, or one of its descendants when the link publishes a
   * folder. `pageId` is validated against the link's subtree, so a guessed id from
   * elsewhere in the workspace answers 404.
   */
  async getPublicPage(
    link: NotePageLink,
    pageId?: number,
  ): Promise<Record<string, unknown>> {
    const page = await this.resolvePageInScope(link, pageId);
    return this.mapper.toPublicDto(page, { showAuthor: link.showAuthor });
  }

  /**
   * The published subtree, for the reader's navigation. Empty unless the link was
   * created with includeChildren — publishing a single page publishes a single page.
   */
  async getPublicTree(link: NotePageLink): Promise<Array<Record<string, unknown>>> {
    if (!link.includeChildren) return [];
    const pages = await this.notes.findSubtree(link.notePageId);
    return pages.map((page) => ({
      id: page.id,
      parentId: page.parent?.id ?? null,
      title: page.title,
      icon: page.icon ?? null,
      kind: page.kind ?? 'page',
      position: page.position,
    }));
  }

  /**
   * Signs an S3 key **only** if that key actually appears in a document this link
   * publishes.
   *
   * Without this check the endpoint would sign whatever key it was handed, turning
   * every public link into a read oracle over the entire bucket — every attachment of
   * every lead, invoice and project. The note's own images are the only thing the
   * reader was given.
   */
  async getImageUrl(link: NotePageLink, key: string): Promise<string> {
    const allowed = await this.allowedImageKeys(link);
    if (!allowed.has(key)) {
      this.logger.warn(
        `Share link ${link.id} requested image key outside its own document: ${key}`,
      );
      throw new NoteShareLinkNotFoundException();
    }

    const result = await this.s3.getPresignedGetUrl({
      key,
      expiresInSeconds: IMAGE_URL_TTL_SECONDS,
    });
    return result.url;
  }

  private async allowedImageKeys(link: NotePageLink): Promise<Set<string>> {
    const cacheKey = `note-share:${link.id}:image-keys`;
    const cached = await this.cache.get<string[]>(cacheKey);
    if (cached) return new Set(cached);

    const pages = link.includeChildren
      ? await this.notes.findSubtree(link.notePageId)
      : [await this.requirePage(link.notePageId)];

    const keys = new Set<string>();
    for (const page of pages) {
      for (const key of collectImageKeys(page.content)) keys.add(key);
    }

    await this.cache.set(cacheKey, [...keys], KEY_SET_CACHE_TTL_MS);
    return keys;
  }

  /**
   * Verifies a link's password and mints the unlock proof.
   *
   * The JWT names the link id, so a cookie earned on one published note cannot open
   * another — every guard re-checks that the id matches the link it is protecting.
   */
  async unlock(link: NotePageLink, password: string): Promise<string> {
    if (!link.passwordHash) {
      // No password set: nothing to unlock, and pretending otherwise would mint a
      // cookie that grants access the guard never asked for.
      throw new NoteShareLinkNotFoundException();
    }

    const valid = await verifySharePassword(password, link.passwordHash);
    if (!valid) throw new NoteShareLinkPasswordInvalidException();

    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) throw new NoteShareLinkNotFoundException();

    return new SignJWT({ linkId: link.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${SHARE_UNLOCK_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(secret));
  }

  /**
   * Counting a read must never slow one down, so this is fire-and-forget: a lost
   * increment is a far smaller problem than a public page that waits on three writes.
   */
  recordView(
    link: NotePageLink,
    request: { ip?: string; userAgent?: string; referer?: string },
  ): void {
    executeInBackground(
      () =>
        this.links.recordView({
          linkId: link.id,
          ipHash: hashVisitorIp(
            request.ip,
            this.config.get<string>('NOTE_SHARE_IP_SALT'),
          ),
          userAgent: request.userAgent?.slice(0, 255) ?? null,
          referer: request.referer?.slice(0, 512) ?? null,
        }),
      `record view for share link ${link.id}`,
      this.logger,
    );
  }

  private async resolvePageInScope(
    link: NotePageLink,
    pageId?: number,
  ): Promise<NotePage> {
    if (pageId == null || pageId === link.notePageId) {
      return this.requirePage(link.notePageId);
    }

    if (!link.includeChildren) throw new NoteShareLinkNotFoundException();

    const inScope = await this.notes.isDescendantOf(pageId, link.notePageId);
    if (!inScope) throw new NoteShareLinkNotFoundException();

    return this.requirePage(pageId);
  }

  private async requirePage(id: number): Promise<NotePage> {
    const page = await this.notes.findByIdActive(id);
    if (!page) throw new NoteShareLinkNotFoundException();
    return page;
  }
}
