import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotePageLink } from '../../../entities/note-page-link.entity';
import { NotePage } from '../../../entities/note-page.entity';
import {
  NoteInheritedShareException,
  NoteNotFoundException,
  NoteSelfShareException,
  NoteShareNotFoundException,
  NoteShareSubjectNotFoundException,
  NoteSharingRequiresUserException,
} from '../../../common/exceptions';
import { UsersRepository } from '../../users/user-management/repositories/users.repository';
import { RolesRepository } from '../../users/user-management/repositories/roles.repository';
import { NotesRepository } from '../note-management/repositories/notes.repository';
import { NoteSharesRepository } from '../note-management/repositories/note-shares.repository';
import {
  NoteLinksRepository,
  NoteLinkColumnChanges,
} from '../note-management/repositories/note-links.repository';
import {
  NoteAccessService,
  NoteActor,
} from '../note-management/services/note-access.service';
import { CreateNoteShareDto } from '../note-management/dto/create-note-share.dto';
import { UpdateNoteShareDto } from '../note-management/dto/update-note-share.dto';
import { CreateNoteLinkDto } from '../note-management/dto/create-note-link.dto';
import { UpdateNoteLinkDto } from '../note-management/dto/update-note-link.dto';
import {
  generateShareToken,
  hashSharePassword,
} from './services/share-token.util';
import { NoteShareMapper } from './mappers/note-share.mapper';

@Injectable()
export class NoteSharingService {
  private readonly logger = new Logger(NoteSharingService.name);

  constructor(
    private readonly notes: NotesRepository,
    private readonly shares: NoteSharesRepository,
    private readonly links: NoteLinksRepository,
    private readonly access: NoteAccessService,
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly mapper: NoteShareMapper,
    private readonly config: ConfigService,
  ) {}

  /**
   * MCP authenticates with a shared server token and no person behind it. It may read
   * notes — every notes_* tool depends on that — but handing it the ability to publish
   * one to the internet, or to grant standing access to a colleague, would make an
   * irreversible outward-facing action something an agent can take on its own.
   */
  private requireUser(actor?: NoteActor): NoteActor {
    if (!actor) throw new NoteSharingRequiresUserException();
    return actor;
  }

  private async loadPage(id: number): Promise<NotePage> {
    const page = await this.notes.findByIdActive(id);
    if (!page) throw new NoteNotFoundException(id);
    return page;
  }

  /** Everything the share dialog renders, in one round trip. */
  async getAccessPanel(pageId: number, actor?: NoteActor): Promise<any> {
    const page = await this.loadPage(pageId);
    const myAccess = await this.access.assertCanRead(page, actor);

    const [shares, links] = await Promise.all([
      this.shares.findSharesForPage(pageId),
      this.links.findByPage(pageId),
    ]);

    return {
      pageId,
      myAccess,
      visibility: page.visibility,
      ownerId: page.ownerId ?? null,
      shares: shares.map((share) => this.mapper.toShareDto(share, pageId)),
      links: links.map((link) => this.mapper.toLinkDto(link)),
    };
  }

  // ------------------------------------------------------------------
  // People
  // ------------------------------------------------------------------

  /**
   * Editors can share, not just the owner: on a team folder that several people
   * maintain, funnelling every "add Ana" through one person is how notes end up pasted
   * into chat instead. Publishing to the web stays owner-only — that one is not
   * reversible for whoever already has the URL.
   */
  async addShare(
    pageId: number,
    dto: CreateNoteShareDto,
    actor?: NoteActor,
  ): Promise<any> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanEdit(page, user);

    if (dto.subjectType === 'user' && dto.subjectId === user.id) {
      throw new NoteSelfShareException();
    }
    await this.assertSubjectExists(dto.subjectType, dto.subjectId);

    const share = await this.shares.upsert({
      notePageId: pageId,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      access: dto.access,
      grantedById: user.id,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    this.logger.log(
      `Note ${pageId} shared with ${dto.subjectType} ${dto.subjectId} as ${dto.access} by user ${user.id}`,
    );

    return this.getAccessPanel(pageId, actor).then((panel) => ({
      ...panel,
      created: { id: share.id },
    }));
  }

  async updateShare(
    pageId: number,
    shareId: number,
    dto: UpdateNoteShareDto,
    actor?: NoteActor,
  ): Promise<any> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanEdit(page, user);

    const share = await this.assertShareBelongsToPage(shareId, pageId);

    await this.shares.update(share.id, {
      ...(dto.access !== undefined ? { access: dto.access } : {}),
      ...(dto.expiresAt !== undefined
        ? { expiresAt: dto.expiresAt === null ? null : new Date(dto.expiresAt) }
        : {}),
    });

    return this.getAccessPanel(pageId, actor);
  }

  async removeShare(
    pageId: number,
    shareId: number,
    actor?: NoteActor,
  ): Promise<void> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanEdit(page, user);

    const share = await this.assertShareBelongsToPage(shareId, pageId);
    await this.shares.delete(share.id);

    this.logger.log(`Note ${pageId} share ${shareId} revoked by user ${user.id}`);
  }

  /**
   * A grant written on an ancestor reaches this page but does not belong to it. Editing
   * it from here would change access for every other page in that subtree — invisibly,
   * from a screen showing one note. The caller is told where it actually lives.
   */
  private async assertShareBelongsToPage(shareId: number, pageId: number) {
    const share = await this.shares.findById(shareId);
    if (!share) throw new NoteShareNotFoundException(shareId);

    if (share.notePageId !== pageId) {
      const owner = await this.notes.findById(share.notePageId);
      throw new NoteInheritedShareException(owner?.title ?? 'another page');
    }
    return share;
  }

  private async assertSubjectExists(
    subjectType: 'user' | 'role',
    subjectId: number,
  ): Promise<void> {
    const found =
      subjectType === 'user'
        ? await this.users.findById(subjectId)
        : await this.roles.findById(subjectId);
    if (!found) throw new NoteShareSubjectNotFoundException(subjectType, subjectId);
  }

  // ------------------------------------------------------------------
  // Public links
  // ------------------------------------------------------------------

  /**
   * Publishing is owner-only, and the raw token exists in the response to this call and
   * nowhere else afterwards — only its SHA-256 is stored.
   */
  async createLink(
    pageId: number,
    dto: CreateNoteLinkDto,
    actor?: NoteActor,
  ): Promise<any> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanManage(page, user);

    const generated = generateShareToken();
    const link = new NotePageLink();
    link.notePageId = pageId;
    link.tokenHash = generated.hash;
    link.tokenHint = generated.hint;
    link.passwordHash = dto.password ? await hashSharePassword(dto.password) : null;
    link.includeChildren = dto.includeChildren ?? false;
    link.allowIndexing = dto.allowIndexing ?? false;
    link.showAuthor = dto.showAuthor ?? true;
    link.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    link.createdById = user.id;

    const saved = await this.links.save(link);

    this.logger.warn(
      `Note ${pageId} published to the web by user ${user.id} (link ${saved.id}, ` +
        `password: ${link.passwordHash ? 'yes' : 'no'}, ` +
        `expires: ${link.expiresAt?.toISOString() ?? 'never'})`,
    );

    return {
      ...this.mapper.toLinkDto(saved),
      url: this.publicUrl(generated.token),
      token: generated.token,
    };
  }

  async listLinks(pageId: number, actor?: NoteActor): Promise<any[]> {
    const page = await this.loadPage(pageId);
    await this.access.assertCanEdit(page, actor);
    const links = await this.links.findByPage(pageId);
    return links.map((link) => this.mapper.toLinkDto(link));
  }

  async updateLink(
    pageId: number,
    linkId: number,
    dto: UpdateNoteLinkDto,
    actor?: NoteActor,
  ): Promise<any> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanManage(page, user);
    const link = await this.assertLinkBelongsToPage(linkId, pageId);

    const changes: NoteLinkColumnChanges = {};
    if (dto.password !== undefined) {
      changes.passwordHash = dto.password === null ? null : await hashSharePassword(dto.password);
    }
    if (dto.includeChildren !== undefined) changes.includeChildren = dto.includeChildren;
    if (dto.allowIndexing !== undefined) changes.allowIndexing = dto.allowIndexing;
    if (dto.showAuthor !== undefined) changes.showAuthor = dto.showAuthor;
    if (dto.expiresAt !== undefined) {
      changes.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }

    await this.links.update(link.id, changes);
    const updated = await this.links.findById(link.id);
    return this.mapper.toLinkDto(updated!);
  }

  /**
   * Rotation revokes the old link and issues a new one in its place, so a URL that
   * reached the wrong inbox stops working without the note being unpublished. The old
   * row stays for the audit trail and keeps its view history.
   */
  async rotateLink(pageId: number, linkId: number, actor?: NoteActor): Promise<any> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanManage(page, user);
    const previous = await this.assertLinkBelongsToPage(linkId, pageId);

    await this.links.update(previous.id, { revokedAt: new Date() });

    const generated = generateShareToken();
    const link = new NotePageLink();
    link.notePageId = pageId;
    link.tokenHash = generated.hash;
    link.tokenHint = generated.hint;
    // Everything about how the link behaves carries over — only the secret changes.
    link.passwordHash = previous.passwordHash ?? null;
    link.includeChildren = previous.includeChildren;
    link.allowIndexing = previous.allowIndexing;
    link.showAuthor = previous.showAuthor;
    link.expiresAt = previous.expiresAt ?? null;
    link.createdById = user.id;

    const saved = await this.links.save(link);
    this.logger.warn(
      `Note ${pageId} share link ${previous.id} rotated to ${saved.id} by user ${user.id}`,
    );

    return {
      ...this.mapper.toLinkDto(saved),
      url: this.publicUrl(generated.token),
      token: generated.token,
    };
  }

  async revokeLink(pageId: number, linkId: number, actor?: NoteActor): Promise<void> {
    const user = this.requireUser(actor);
    const page = await this.loadPage(pageId);
    await this.access.assertCanManage(page, user);
    const link = await this.assertLinkBelongsToPage(linkId, pageId);

    await this.links.update(link.id, { revokedAt: new Date() });
    this.logger.warn(
      `Note ${pageId} share link ${linkId} revoked by user ${user.id}`,
    );
  }

  /** Totals, unique visitors and a 30-day daily series for one link. */
  async getLinkStats(pageId: number, linkId: number, actor?: NoteActor): Promise<any> {
    const page = await this.loadPage(pageId);
    await this.access.assertCanManage(page, actor);
    const link = await this.assertLinkBelongsToPage(linkId, pageId);

    const [uniqueVisitors, byDay, recent] = await Promise.all([
      this.links.countUniqueVisitors(link.id),
      this.links.findViewsByDay(link.id, 30),
      this.links.findRecentViews(link.id, 20),
    ]);

    return {
      linkId: link.id,
      totalViews: link.viewCount,
      uniqueVisitors,
      lastViewedAt: link.lastViewedAt ?? null,
      byDay,
      recent: recent.map((view) => ({
        viewedAt: view.viewedAt,
        userAgent: view.userAgent ?? null,
        referer: view.referer ?? null,
      })),
    };
  }

  /**
   * Every live link in the workspace. This is the screen that matters the day somebody
   * leaves the company and nobody remembers what they published.
   */
  async listAllActiveLinks(): Promise<any[]> {
    const links = await this.links.findAllActive();
    return links.map((link) => ({
      ...this.mapper.toLinkDto(link),
      page: link.page
        ? { id: link.page.id, title: link.page.title, icon: link.page.icon ?? null }
        : null,
      createdBy: link.createdBy
        ? {
            id: link.createdBy.id,
            name: link.createdBy.name ?? null,
            email: link.createdBy.email,
          }
        : null,
    }));
  }

  /** Workspace-admin escape hatch used by the public-links settings screen. */
  async revokeLinkAsAdmin(linkId: number, actor?: NoteActor): Promise<void> {
    const user = this.requireUser(actor);
    const link = await this.links.findById(linkId);
    if (!link) throw new NoteShareNotFoundException(linkId);

    await this.links.update(link.id, { revokedAt: new Date() });
    this.logger.warn(`Note ${link.notePageId} share link ${link.id} admin-revoked by user ${user.id}`);
  }

  private async assertLinkBelongsToPage(linkId: number, pageId: number) {
    const link = await this.links.findById(linkId);
    if (!link || link.notePageId !== pageId) {
      throw new NoteShareNotFoundException(linkId);
    }
    return link;
  }

  private publicUrl(token: string): string {
    const base = (
      this.config.get<string>('PUBLIC_APP_BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/p/${token}`;
  }
}
