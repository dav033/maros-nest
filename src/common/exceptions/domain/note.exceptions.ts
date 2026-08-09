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

/**
 * Deliberately a 404 with the same message shape as NoteNotFoundException: a 403 would
 * confirm that the note exists, which is exactly what someone walking ids is looking
 * for. Distinct class so call sites read as intent; identical response on the wire.
 */
export class NoteAccessDeniedException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Note page not found with id: ${id}`);
  }
}

/** Unknown, revoked, or pointing at a trashed page — all answer the same, on purpose. */
export class NoteShareLinkNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('Share link not found');
  }
}

/**
 * 410 rather than 404: the reader had a real link and deserves to be told it aged out,
 * not left wondering whether they mistyped it. Nothing about the note leaks either way.
 */
export class NoteShareLinkExpiredException extends BaseException {
  constructor() {
    super('This share link has expired', HttpStatus.GONE, 'NOTE_LINK_EXPIRED');
  }
}

export class NoteShareLinkPasswordRequiredException extends BaseException {
  constructor() {
    super(
      'This share link is password protected',
      HttpStatus.UNAUTHORIZED,
      'NOTE_LINK_PASSWORD_REQUIRED',
    );
  }
}

export class NoteShareLinkPasswordInvalidException extends BaseException {
  constructor() {
    super('Incorrect password', HttpStatus.UNAUTHORIZED, 'NOTE_LINK_PASSWORD_INVALID');
  }
}

/** Sharing a note with yourself: harmless, but always a mistake worth naming. */
export class NoteSelfShareException extends BusinessException {
  constructor() {
    super('You already have access to this note', 'NOTE_SELF_SHARE');
  }
}

export class NoteShareSubjectNotFoundException extends ResourceNotFoundException {
  constructor(subjectType: string, subjectId: number) {
    super(`No ${subjectType} found with id: ${subjectId}`);
  }
}

export class NoteShareNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Note share not found with id: ${id}`);
  }
}

/**
 * A grant written on an ancestor cannot be edited from the descendant it happens to
 * reach — the fix belongs on the folder that carries it, or the change would silently
 * affect every other page in that subtree.
 */
export class NoteInheritedShareException extends BusinessException {
  constructor(grantedOnTitle: string) {
    super(
      `This access is inherited from "${grantedOnTitle}" — change it there`,
      'NOTE_INHERITED_SHARE',
    );
  }
}

/** MCP authenticates with a shared token; publishing to the internet needs a person. */
export class NoteSharingRequiresUserException extends BusinessException {
  constructor() {
    super('Sharing actions require a signed-in user', 'NOTE_SHARING_REQUIRES_USER');
  }
}

export const NoteExceptions = {
  NoteNotFoundException,
  NoteTagNotFoundException,
  NoteCycleException,
  NotePageStaleContentException,
  NoteTagNameConflictException,
  NoteFolderHasNoContentException,
  NoteAccessDeniedException,
  NoteShareLinkNotFoundException,
  NoteShareLinkExpiredException,
  NoteShareLinkPasswordRequiredException,
  NoteShareLinkPasswordInvalidException,
  NoteSelfShareException,
  NoteShareSubjectNotFoundException,
  NoteShareNotFoundException,
  NoteInheritedShareException,
  NoteSharingRequiresUserException,
};
