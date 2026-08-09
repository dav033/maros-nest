import { Injectable } from '@nestjs/common';
import { NotePage } from '../../../../entities/note-page.entity';
import { NoteShareAccess } from '../../../../entities/note-page-share.entity';
import { NoteAccessDeniedException } from '../../../../common/exceptions';
import type { AuthenticatedUser } from '../../../../common/auth/authenticated-user';
import { NoteSharesRepository } from '../repositories/note-shares.repository';

/**
 * Effective access to a note, weakest first.
 *
 * `commenter` sits between viewer and editor and is granted, stored and enforced from
 * day one, but no comments UI exists yet — until it does it behaves exactly like
 * `viewer`. A declared gap is better than a level invented later on top of live data.
 */
export type NoteAccess = 'none' | 'viewer' | 'commenter' | 'editor' | 'owner';

const ACCESS_RANK: Record<NoteAccess, number> = {
  none: 0,
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export function atLeast(actual: NoteAccess, required: NoteAccess): boolean {
  return ACCESS_RANK[actual] >= ACCESS_RANK[required];
}

function strongest(a: NoteAccess, b: NoteAccess): NoteAccess {
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

/**
 * The caller, reduced to what access decisions actually need.
 *
 * `undefined` in place of an actor is the MCP context: a shared server token with no
 * per-user identity, deliberately trusted with everything — see NoteAccessService.
 */
export interface NoteActor {
  id: number;
  roleId: number | null;
  /** Has `notes:write`. A team note is only editable by someone who can write notes. */
  canWrite: boolean;
}

export function toNoteActor(user: AuthenticatedUser): NoteActor {
  return {
    id: user.id,
    roleId: user.role?.id ?? null,
    canWrite: user.permissions.includes('notes:write'),
  };
}

/**
 * The single place that answers "what may this person do with this note".
 *
 * Before this existed the rule was written three times — a util, a query builder and a
 * raw SQL string — and adding a fourth reader was how it would eventually diverge.
 * Listing queries still need the rule expressed as SQL (NotesRepository.visibleSubquery)
 * but both now describe the same three sources of access: ownership, team visibility,
 * and grants inherited down the tree.
 *
 * ## Failure codes
 *
 * No read access is always **404**, never 403 — a 403 would confirm that a note exists,
 * which is exactly what someone probing ids is after. This is the policy the previous
 * `assertNoteVisible` already chose and it is kept deliberately.
 */
@Injectable()
export class NoteAccessService {
  constructor(private readonly shares: NoteSharesRepository) {}

  /**
   * `actor` undefined means MCP: a shared token with no user behind it, so there is no
   * ownership to check it against. It is treated as a trusted system context and sees
   * everything — narrowing that would break every notes_* tool at once. What MCP
   * deliberately cannot do is publish or share (see NoteSharingService), because
   * exposing a document to the internet must not be an action an agent can take.
   */
  async accessFor(page: NotePage, actor?: NoteActor): Promise<NoteAccess> {
    if (!actor) return 'owner';

    let access = this.baselineAccess(page, actor);

    // A grant can only raise the level, never lower it: sharing a team note as
    // "viewer" with someone who could already edit it is not a demotion.
    if (!atLeast(access, 'owner')) {
      const grants = await this.shares.findEffectiveGrants(
        page.id,
        actor.id,
        actor.roleId,
      );
      for (const grant of grants) {
        access = strongest(access, grant.access as NoteAccess);
      }
    }

    return access;
  }

  /**
   * Access that needs no database lookup: ownership and team visibility.
   *
   * Legacy notes (owner_id NULL) resolve to `owner` for anyone who can write. They
   * predate the owner column and are already fully editable and deletable by the whole
   * team today, so this grants nothing new — it only keeps them publishable, which a
   * strict "owner only" rule would make impossible for the notes that need it most.
   */
  private baselineAccess(page: NotePage, actor: NoteActor): NoteAccess {
    if (page.ownerId != null) {
      if (page.ownerId === actor.id) return 'owner';
    } else if (page.visibility === 'team' && actor.canWrite) {
      return 'owner';
    }

    if (page.visibility === 'team') {
      return actor.canWrite ? 'editor' : 'viewer';
    }

    return 'none';
  }

  /** Throws 404 when the actor cannot reach `required` on this page. */
  async assert(
    page: NotePage,
    required: NoteAccess,
    actor?: NoteActor,
  ): Promise<NoteAccess> {
    const access = await this.accessFor(page, actor);
    if (!atLeast(access, required)) {
      throw new NoteAccessDeniedException(page.id);
    }
    return access;
  }

  /** Convenience wrappers, so call sites read as intent rather than as levels. */
  async assertCanRead(page: NotePage, actor?: NoteActor): Promise<NoteAccess> {
    return this.assert(page, 'viewer', actor);
  }

  async assertCanEdit(page: NotePage, actor?: NoteActor): Promise<NoteAccess> {
    return this.assert(page, 'editor', actor);
  }

  /** Publishing, changing visibility and revoking links are owner-only. */
  async assertCanManage(page: NotePage, actor?: NoteActor): Promise<NoteAccess> {
    return this.assert(page, 'owner', actor);
  }
}
