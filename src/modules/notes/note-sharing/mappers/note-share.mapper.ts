import { Injectable } from '@nestjs/common';
import { NotePageLink } from '../../../../entities/note-page-link.entity';
import { ShareWithSubjectRow } from '../../note-management/repositories/note-shares.repository';

@Injectable()
export class NoteShareMapper {
  /**
   * `inheritedFrom` is the whole point of this DTO: a grant written on an ancestor
   * reaches this page but cannot be edited from it, and the dialog has to say so rather
   * than offering a control that would quietly change access for a whole subtree.
   */
  toShareDto(row: ShareWithSubjectRow, pageId: number): Record<string, unknown> {
    const isDirect = row.notePageId === pageId;
    return {
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      access: row.access,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      inheritedFrom: isDirect ? null : row.grantedOnTitle,
      subject: {
        name: row.subjectName,
        email: row.subjectEmail,
        picture: row.subjectPicture,
      },
    };
  }

  /**
   * Never carries the token. It is not stored in a recoverable form, so this is not a
   * precaution the mapper is taking — there is simply nothing to return. `tokenHint`
   * is enough to tell two links apart; a link whose URL was lost gets rotated, not
   * recovered.
   */
  toLinkDto(link: NotePageLink): Record<string, unknown> {
    const isExpired = !!link.expiresAt && link.expiresAt.getTime() <= Date.now();
    return {
      id: link.id,
      tokenHint: link.tokenHint,
      hasPassword: !!link.passwordHash,
      includeChildren: link.includeChildren,
      allowIndexing: link.allowIndexing,
      showAuthor: link.showAuthor,
      expiresAt: link.expiresAt ?? null,
      revokedAt: link.revokedAt ?? null,
      isActive: !link.revokedAt && !isExpired,
      viewCount: link.viewCount,
      lastViewedAt: link.lastViewedAt ?? null,
      createdAt: link.createdAt,
      createdById: link.createdById ?? null,
    };
  }
}
