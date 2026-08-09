import { Injectable } from '@nestjs/common';
import { NotesRepository } from '../repositories/notes.repository';
import { NoteCycleException, NoteNotFoundException } from '../../../../common/exceptions';
import { computeInsertPosition } from './note-position.util';
import { NoteAccessService, NoteActor } from './note-access.service';

const POSITION_STEP = 1000;

export interface MoveNoteResult {
  id: number;
  parentId: number | null;
  position: number;
  /**
   * True when the move changed who can reach the page: grants are inherited downward,
   * so leaving a shared folder silently drops everyone the folder was shared with. The
   * client surfaces it as a toast — losing access in silence is how people end up
   * unable to open a note nobody remembers moving.
   */
  accessChanged: boolean;
}

@Injectable()
export class NoteTreeService {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly noteAccess: NoteAccessService,
  ) {}

  /** Walks up from targetParentId; throws if pageId is itself an ancestor (a cycle). */
  async assertNoCycle(pageId: number, targetParentId: number): Promise<void> {
    if (targetParentId === pageId) {
      throw new NoteCycleException(pageId, targetParentId);
    }

    const parentMap = new Map(
      (await this.notesRepository.getActiveParentMap()).map((row) => [row.id, row.parentId]),
    );

    let current: number | null | undefined = targetParentId;
    const visited = new Set<number>();
    while (current != null) {
      if (current === pageId) {
        throw new NoteCycleException(pageId, targetParentId);
      }
      if (visited.has(current)) break; // defensive: pre-existing corrupt chain, don't loop forever
      visited.add(current);
      current = parentMap.get(current);
    }
  }

  /**
   * Reparenting needs edit access on both ends: on the page, and on the folder it lands
   * in. Requiring it on the target is what stops a page being dropped into a subtree
   * the mover cannot see, which would hand its readers a note they were never given.
   */
  async move(
    pageId: number,
    parentId: number | null,
    actor?: NoteActor,
    beforeId?: number | null,
    afterId?: number | null,
  ): Promise<MoveNoteResult> {
    const page = await this.notesRepository.findByIdActive(pageId);
    if (!page) throw new NoteNotFoundException(pageId);
    await this.noteAccess.assertCanEdit(page, actor);

    const previousParentId = page.parent?.id ?? null;

    if (parentId != null) {
      const parent = await this.notesRepository.findByIdActive(parentId);
      if (!parent) throw new NoteNotFoundException(parentId);
      await this.noteAccess.assertCanEdit(parent, actor);
      await this.assertNoCycle(pageId, parentId);
      page.parent = parent;
    } else {
      page.parent = null;
    }

    const position = await this.resolvePosition(pageId, parentId, beforeId, afterId);
    page.position = position;

    const saved = await this.notesRepository.save(page);

    return {
      id: saved.id,
      parentId: saved.parent?.id ?? null,
      position: saved.position,
      accessChanged:
        previousParentId !== (saved.parent?.id ?? null) &&
        (await this.hasInheritedGrants(previousParentId)),
    };
  }

  /**
   * Whether the old parent chain carried any grant at all. A plain reorder inside the
   * same folder changes nothing and must not raise a warning, so this is only consulted
   * when the parent actually changed.
   */
  private async hasInheritedGrants(parentId: number | null): Promise<boolean> {
    if (parentId == null) return false;
    return this.notesRepository.hasGrantsOnAncestry(parentId);
  }

  private async resolvePosition(
    pageId: number,
    parentId: number | null,
    beforeId?: number | null,
    afterId?: number | null,
  ): Promise<number> {
    let siblings = await this.notesRepository.getSiblings(parentId, pageId);
    let position = computeInsertPosition(siblings, POSITION_STEP, beforeId, afterId);

    if (position === null) {
      // Gap exhausted between neighbors — rebalance this sibling list to clean
      // multiples of the step, then retry once against the fresh positions.
      await this.notesRepository.rebalanceSiblings(
        siblings.map((s) => s.id),
        POSITION_STEP,
      );
      siblings = await this.notesRepository.getSiblings(parentId, pageId);
      position = computeInsertPosition(siblings, POSITION_STEP, beforeId, afterId);
    }

    return position ?? POSITION_STEP;
  }
}
