import { HttpStatus } from '@nestjs/common';
import { ResourceNotFoundException } from '../resource-not-found.exception';
import { BusinessException } from '../business.exception';
import { BaseException } from '../base.exception';

export class NoteNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Note page not found with id: ${id}`);
  }
}

export class NoteTagNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Note tag not found with id: ${id}`);
  }
}

export class NoteCycleException extends BusinessException {
  constructor(pageId: number, parentId: number) {
    super(
      `Cannot move note ${pageId} under ${parentId}: target is a descendant of the moved page`,
      'NOTE_CYCLE',
    );
  }
}

/**
 * Optimistic-concurrency guard for the content autosave endpoint: the client sends the
 * updatedAt it last saw, and this fires if another write landed first (multi-tab, no auth).
 */
export class NotePageStaleContentException extends BaseException {
  constructor(id: number) {
    super(
      `Note page ${id} was modified since it was last loaded`,
      HttpStatus.CONFLICT,
      'NOTE_STALE_CONTENT',
    );
  }
}

export class NoteTagNameConflictException extends BaseException {
  constructor(name: string) {
    super(`A tag named "${name}" already exists`, HttpStatus.CONFLICT, 'NOTE_TAG_NAME_CONFLICT');
  }
}

/** Folders group pages; they have no document of their own to write to. */
export class NoteFolderHasNoContentException extends BusinessException {
  constructor(id: number) {
    super(`Note page ${id} is a folder and has no editable content`, 'NOTE_FOLDER_NO_CONTENT');
  }
}

export const NoteExceptions = {
  NoteNotFoundException,
  NoteTagNotFoundException,
  NoteCycleException,
  NotePageStaleContentException,
  NoteTagNameConflictException,
  NoteFolderHasNoContentException,
};
