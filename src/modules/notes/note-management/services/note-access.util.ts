import { NotePage } from '../../../../entities/note-page.entity';
import { NoteNotFoundException } from '../../../../common/exceptions';

/**
 * Standalone notes (no entity_kind) with an owner are private to their creator —
 * not even other roles can see them; notes:read only ever gated the module, it
 * never implied "see everyone's notes." Entity-linked notes, and legacy notes
 * with no owner_id (predate this column), stay shared for anyone with notes:read.
 */
export function isPrivateNote(page: Pick<NotePage, 'entityKind' | 'ownerId'>): boolean {
  return page.entityKind == null && page.ownerId != null;
}

/**
 * Throws NoteNotFoundException (404), not a 403, when a private note belongs to
 * someone else — so a non-owner can't distinguish "doesn't exist" from "exists but
 * isn't yours" by response code.
 *
 * userId is undefined for MCP tool calls, which authenticate with a shared token
 * rather than a per-user session and have no owner to check against — treated as
 * a trusted system context that isn't restricted by note privacy.
 */
export function assertNoteVisible(page: NotePage, userId?: number): void {
  if (userId === undefined) return;
  if (isPrivateNote(page) && page.ownerId !== userId) {
    throw new NoteNotFoundException(page.id);
  }
}
