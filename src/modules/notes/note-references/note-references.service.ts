import { Injectable } from '@nestjs/common';
import { NotePage } from '../../../entities/note-page.entity';
import {
  type NoteReference,
  type NoteReferenceKind,
  type NoteReferenceOrigin,
} from '../../../entities/note-reference.entity';
import { NoteNotFoundException } from '../../../common/exceptions';
import {
  extractReferenceContexts,
  extractReferencesFromTipTapDoc,
} from '../../../common/utils/tiptap-references.util';
import { NotesRepository } from '../note-management/repositories/notes.repository';
import type { NoteActor } from '../note-management/services/note-access.service';
import { NoteAccessService } from '../note-management/services/note-access.service';
import {
  NoteReferencesRepository,
  type NoteReferenceDraft,
} from './repositories/note-references.repository';
import {
  NoteReferenceTargetsService,
  type NoteReferenceTarget,
} from './services/note-reference-targets.service';

/** One outgoing reference, resolved against live data and ready to render as a chip. */
export interface ResolvedNoteReference extends NoteReferenceTarget {
  origin: NoteReferenceOrigin;
}

/** One note pointing at something, with the lines it points from. */
export interface NoteBacklink {
  page: { id: number; title: string; icon: string | null; updatedAt: Date };
  origins: NoteReferenceOrigin[];
  /** Text of the blocks holding the mention. Empty for a relation pinned in the header. */
  contexts: string[];
}

/**
 * The four kinds note_pages.entity_kind can hold. Anything else — a task, a colleague,
 * another note — is a relation and nothing more; it has no primary slot to be promoted
 * into. See syncPrimaryRelation.
 */
const PRIMARY_RELATION_KINDS: readonly NoteReferenceKind[] = [
  'lead',
  'project',
  'contact',
  'company',
];

/** Every kind the `@` picker offers, in the order the menu groups them. */
export const MENTION_SEARCH_KINDS: readonly NoteReferenceKind[] = [
  'lead',
  'project',
  'contact',
  'company',
  'task',
  'user',
  'note',
];

@Injectable()
export class NoteReferencesService {
  constructor(
    private readonly references: NoteReferencesRepository,
    private readonly targets: NoteReferenceTargetsService,
    private readonly notes: NotesRepository,
    private readonly access: NoteAccessService,
  ) {}

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Brings the page's inline references in line with the document just saved.
   *
   * Called from NotesService.updateNoteContent on every autosave, which is why it does
   * no existence checks and raises nothing: a chip pointing at a deleted lead must not
   * be what stops someone saving the paragraph around it. Unresolvable targets are kept
   * as rows and rendered from their snapshot.
   */
  async syncInlineFromContent(
    pageId: number,
    content: unknown,
    actor?: NoteActor,
  ): Promise<void> {
    const extracted = extractReferencesFromTipTapDoc(content);
    const drafts: NoteReferenceDraft[] = extracted
      // A note linking to itself is not a backlink, it is a loop in the panel.
      .filter((ref) => !(ref.kind === 'note' && ref.id === pageId))
      .map((ref) => ({ targetKind: ref.kind, targetId: ref.id, label: ref.label }));

    await this.references.replaceInline(pageId, drafts, actor?.id);
  }

  /** Pins a relation in the note header. Needs edit rights on the note, like any other edit. */
  async addRelation(
    pageId: number,
    kind: string,
    targetId: number,
    actor?: NoteActor,
  ): Promise<ResolvedNoteReference[]> {
    const page = await this.loadEditable(pageId, actor);
    const targetKind = this.targets.assertSupportedKind(kind);
    const target = await this.targets.assertExists(targetKind, targetId);

    await this.references.addRelation(
      pageId,
      { targetKind, targetId, label: target.label },
      actor?.id,
    );
    await this.syncPrimaryRelation(page);
    return this.listForPage(pageId, actor);
  }

  async removeRelation(
    pageId: number,
    kind: string,
    targetId: number,
    actor?: NoteActor,
  ): Promise<ResolvedNoteReference[]> {
    const page = await this.loadEditable(pageId, actor);
    const targetKind = this.targets.assertSupportedKind(kind);

    await this.references.removeRelation(pageId, targetKind, targetId);
    await this.syncPrimaryRelation(page);
    return this.listForPage(pageId, actor);
  }

  /**
   * Replaces the primary relation — what `PATCH /notes/:id/entity` and the MCP
   * `notes_set_entity` tool have always done, re-expressed as one relation among many.
   *
   * Only the previous primary is dropped. Pinning a note to a lead through the old
   * single-link endpoint must not quietly unpin the three other records someone related
   * it to in the header.
   */
  async setPrimaryRelation(
    page: NotePage,
    kind: NoteReferenceKind | null,
    targetId: number | null,
    actor?: NoteActor,
  ): Promise<void> {
    if (page.entityKind && page.entityId != null) {
      await this.references.removeRelation(
        page.id,
        page.entityKind as NoteReferenceKind,
        page.entityId,
      );
    }

    if (kind !== null && targetId !== null) {
      const target = await this.targets.assertExists(kind, targetId);
      await this.references.addRelation(
        page.id,
        { targetKind: kind, targetId, label: target.label },
        actor?.id,
      );
      // Handed on as the preference: the caller named this record as *the* entity link,
      // so it has to end up in the columns. Letting syncPrimaryRelation re-derive "oldest
      // eligible" here would answer the request with a different record than it asked for
      // whenever the note already had an older relation.
      await this.syncPrimaryRelation(page, { kind, targetId });
      return;
    }

    await this.syncPrimaryRelation(page);
  }

  /**
   * Rewrites note_pages.entity_kind/entity_id from the relations that now exist.
   *
   * Those two columns are a denormalized cache of *one* relation, kept because
   * /notes/by-entity, the note tree DTO and the MCP tools were all built on them. This
   * method is their only writer, which is what keeps the cache and note_references from
   * drifting.
   *
   * Without a preference the primary is the oldest relation of a kind the columns can
   * hold, so it stays stable: pinning a fifth record does not reshuffle which one the list
   * views show. With one — the record PATCH /notes/:id/entity just named — that record
   * wins, because an endpoint whose whole job is setting the entity link must not answer
   * with a different one.
   */
  private async syncPrimaryRelation(
    page: NotePage,
    preferred?: { kind: NoteReferenceKind; targetId: number },
  ): Promise<void> {
    const eligible = (kind: NoteReferenceKind) => PRIMARY_RELATION_KINDS.includes(kind);

    const rows = await this.references.findByPage(page.id);
    const relations = rows.filter((row) => row.origin === 'relation' && eligible(row.targetKind));

    // The preference still has to be among the relations that exist: a kind the columns
    // cannot hold (a task, a colleague) is not promotable no matter who asked.
    const chosen =
      (preferred && eligible(preferred.kind)
        ? relations.find(
            (row) => row.targetKind === preferred.kind && row.targetId === preferred.targetId,
          )
        : undefined) ?? [...relations].sort((a, b) => a.id - b.id)[0];

    const nextKind = chosen?.targetKind ?? null;
    const nextId = chosen?.targetId ?? null;
    if ((page.entityKind ?? null) === nextKind && (page.entityId ?? null) === nextId) return;

    page.entityKind = nextKind;
    page.entityId = nextId;
    await this.notes.save(page);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** Everything this note points at, newest relations first, then the body's mentions. */
  async listForPage(pageId: number, actor?: NoteActor): Promise<ResolvedNoteReference[]> {
    const page = await this.notes.findByIdActive(pageId);
    if (!page) throw new NoteNotFoundException(pageId);
    await this.access.assertCanRead(page, actor);

    const rows = await this.references.findByPage(pageId);
    return this.resolveRows(rows);
  }

  /**
   * Notes that point at this note — the "Linked references" panel.
   *
   * The contexts come from each source note's own document, so the panel says where the
   * link was made rather than only that it exists.
   */
  async listBacklinks(pageId: number, actor?: NoteActor): Promise<NoteBacklink[]> {
    const page = await this.notes.findByIdActive(pageId);
    if (!page) throw new NoteNotFoundException(pageId);
    await this.access.assertCanRead(page, actor);

    return this.backlinksFor('note', pageId, actor, { excludePageId: pageId });
  }

  /**
   * Notes that point at a CRM record — what the lead, project, contact, company and task
   * pages show.
   *
   * No permission check on the *record*: the caller is already looking at it. The notes
   * themselves are filtered by note visibility in the repository, so this cannot be used
   * to read a private note through the lead it mentions.
   */
  async listNotesReferencing(
    kind: string,
    targetId: number,
    actor?: NoteActor,
    origins?: NoteReferenceOrigin[],
  ): Promise<NoteBacklink[]> {
    const targetKind = this.targets.assertSupportedKind(kind);
    return this.backlinksFor(targetKind, targetId, actor, { origins });
  }

  private async backlinksFor(
    targetKind: NoteReferenceKind,
    targetId: number,
    actor?: NoteActor,
    options: { origins?: NoteReferenceOrigin[]; excludePageId?: number } = {},
  ): Promise<NoteBacklink[]> {
    const rows = await this.references.findPagesReferencing(targetKind, targetId, actor, options);

    return rows.map(({ page, origins }) => ({
      page: {
        id: page.id,
        title: page.title || 'Untitled',
        icon: page.icon ?? null,
        updatedAt: page.updatedAt,
      },
      origins,
      contexts: origins.includes('inline')
        ? extractReferenceContexts(page.content, targetKind, targetId)
        : [],
    }));
  }

  /** The `@` and `[[` picker. `kinds` empty means every kind. */
  async search(
    query: string,
    kinds: string[],
    perKind: number,
    actor?: NoteActor,
  ): Promise<NoteReferenceTarget[]> {
    const requested = kinds.length
      ? kinds.map((kind) => this.targets.assertSupportedKind(kind))
      : [...MENTION_SEARCH_KINDS];
    return this.targets.search(query, requested, perKind, actor);
  }

  // -------------------------------------------------------------------------

  private async loadEditable(pageId: number, actor?: NoteActor): Promise<NotePage> {
    const page = await this.notes.findByIdActive(pageId);
    if (!page) throw new NoteNotFoundException(pageId);
    await this.access.assertCanEdit(page, actor);
    return page;
  }

  /**
   * Live labels for stored rows, falling back to the snapshot for a target that is gone.
   *
   * Relations come first and inline mentions after, each group newest first: the header
   * chips are authored and deserve the top of the list, the body's mentions are a
   * by-product of writing.
   */
  private async resolveRows(rows: NoteReference[]): Promise<ResolvedNoteReference[]> {
    if (rows.length === 0) return [];

    const resolved = await this.targets.resolve(
      rows.map((row) => ({ kind: row.targetKind, id: row.targetId })),
    );
    const byKey = new Map(resolved.map((target) => [`${target.kind}:${target.id}`, target]));

    return rows
      .map((row) => {
        const target = byKey.get(`${row.targetKind}:${row.targetId}`);
        const exists = target?.exists ?? false;
        return {
          kind: row.targetKind,
          id: row.targetId,
          label: exists
            ? target!.label
            : row.labelSnapshot || `${row.targetKind} #${row.targetId}`,
          sublabel: exists ? target!.sublabel : null,
          exists,
          origin: row.origin,
        };
      })
      .sort((a, b) => {
        if (a.origin !== b.origin) return a.origin === 'relation' ? -1 : 1;
        return 0;
      });
  }
}
