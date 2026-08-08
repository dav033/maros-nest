import { NotePage } from '../../../../entities/note-page.entity';
import { NoteNotFoundException } from '../../../../common/exceptions';
import { assertNoteVisible, isPrivateNote } from './note-access.util';

function makePage(overrides: Partial<NotePage> = {}): NotePage {
  return Object.assign(new NotePage(), { id: 1, entityKind: undefined, ownerId: undefined }, overrides);
}

describe('isPrivateNote', () => {
  it('is private when standalone (no entity) with an owner', () => {
    expect(isPrivateNote({ entityKind: undefined, ownerId: 5 })).toBe(true);
  });

  it('is not private when linked to a CRM entity, even with an owner', () => {
    expect(isPrivateNote({ entityKind: 'lead', ownerId: 5 })).toBe(false);
  });

  it('is not private when standalone but ownerless (legacy note, predates the column)', () => {
    expect(isPrivateNote({ entityKind: undefined, ownerId: null })).toBe(false);
    expect(isPrivateNote({ entityKind: undefined, ownerId: undefined })).toBe(false);
  });
});

describe('assertNoteVisible', () => {
  it('allows the owner of a private note', () => {
    const page = makePage({ entityKind: undefined, ownerId: 5 });
    expect(() => assertNoteVisible(page, 5)).not.toThrow();
  });

  it('blocks a different user from a private note, as 404 not 403', () => {
    const page = makePage({ entityKind: undefined, ownerId: 5 });
    expect(() => assertNoteVisible(page, 6)).toThrow(NoteNotFoundException);
  });

  it('allows anyone into an entity-linked note regardless of owner', () => {
    const page = makePage({ entityKind: 'project', ownerId: 5 });
    expect(() => assertNoteVisible(page, 999)).not.toThrow();
  });

  it('allows anyone into a legacy note with no owner', () => {
    const page = makePage({ entityKind: undefined, ownerId: null });
    expect(() => assertNoteVisible(page, 999)).not.toThrow();
  });

  it('bypasses the check entirely for MCP (userId undefined) even on a private note', () => {
    const page = makePage({ entityKind: undefined, ownerId: 5 });
    expect(() => assertNoteVisible(page, undefined)).not.toThrow();
  });
});
