import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { NotePageLink } from '../../../../entities/note-page-link.entity';

/** Cookie holding proof that this visitor already entered the link's password. */
export function shareUnlockCookieName(linkId: number): string {
  return `note_share_${linkId}`;
}

/**
 * The same proof, sent as a header.
 *
 * The reader is served from the app host while this API answers from another, and the
 * unlock cookie belongs to whichever of the two set it. Rather than depend on the two
 * hosts staying same-site forever, the Next reader keeps the proof in its own cookie
 * and replays it here as a header — one mechanism that works whatever the hosts are.
 */
export const SHARE_UNLOCK_HEADER = 'x-note-share-unlock';

export const SHARE_UNLOCK_TTL_SECONDS = 8 * 60 * 60;

/**
 * Marks the one route that must stay reachable while the link is still locked — the
 * unlock endpoint itself. Without it the password check would guard the very request
 * that supplies the password.
 */
export const SKIP_LINK_PASSWORD_KEY = 'skipLinkPassword';
export const SkipLinkPassword = () => SetMetadata(SKIP_LINK_PASSWORD_KEY, true);

/** What NoteShareLinkGuard attaches once a token has been resolved and accepted. */
export type RequestWithShareLink = Request & { shareLink?: NotePageLink };
