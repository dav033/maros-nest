import { Injectable } from '@nestjs/common';
import { NotesRepository } from '../repositories/notes.repository';
import { NoteCycleException, NoteNotFoundException } from '../../../../common/exceptions';
import { computeInsertPosition } from './note-position.util';
import { assertNoteVisible } from './note-access.util';

const POSITION_STEP = 1000;

export interface MoveNoteResult {
  id: number;
  parentId: number | null;
  position: number;
}

@Injectable()
export class NoteTreeService {
  constructor(private readonly notesRepository: NotesRepository) {}

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

  async move(
    pageId: number,
    parentId: number | null,
    userId?: number,
    beforeId?: number | null,
    afterId?: number | null,
  ): Promise<MoveNoteResult> {
    const page = await this.notesRepository.findByIdActive(pageId);
    if (!page) throw new NoteNotFoundException(pageId);
    assertNoteVisible(page, userId);

    if (parentId != null) {
      const parent = await this.notesRepository.findByIdActive(parentId);
      if (!parent) throw new NoteNotFoundException(parentId);
      assertNoteVisible(parent, userId);
      await this.assertNoCycle(pageId, parentId);
      page.parent = parent;
    } else {
      page.parent = null;
    }

    const position = await this.resolvePosition(pageId, parentId, beforeId, afterId);
    page.position = position;

    const saved = await this.notesRepository.save(page);
    return { id: saved.id, parentId: saved.parent?.id ?? null, position: saved.position };
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
