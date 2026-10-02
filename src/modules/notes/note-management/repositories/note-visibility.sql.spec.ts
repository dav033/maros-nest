import { NotesRepository } from './notes.repository';
import { noteVisibilitySql } from './note-visibility.sql';

/** Collapses whitespace so the comparison is about the rule, not about indentation. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('noteVisibilitySql', () => {
  it('allows team notes, the owner, and anyone a live grant reaches', () => {
    const sql = flat(noteVisibilitySql({ alias: 'page', userId: ':userId', roleId: ':roleId' }));

    expect(sql).toContain("page.visibility = 'team'");
    expect(sql).toContain('page.owner_id = :userId');
    expect(sql).toContain("s.subject_type = 'user' AND s.subject_id = :userId");
    expect(sql).toContain("s.subject_type = 'role' AND s.subject_id = :roleId");
    expect(sql).toContain('s.expires_at IS NULL OR s.expires_at > now()');
  });

  /**
   * Grants are inherited downward: one on a folder covers everything inside it. The
   * recursive arm is what implements that, and losing it would quietly cut everyone off
   * from the pages under a folder that was shared with them.
   */
  it('walks down the tree from the page carrying the grant', () => {
    const sql = flat(noteVisibilitySql({ alias: 'page', userId: ':userId', roleId: ':roleId' }));

    expect(sql).toContain('WITH RECURSIVE granted AS');
    expect(sql).toContain('SELECT c.id FROM note_pages c JOIN granted g ON c.parent_id = g.id');
  });

  it('drops the role arm for a caller with no role, rather than comparing against null', () => {
    const sql = flat(noteVisibilitySql({ alias: 'page', userId: ':userId', roleId: null }));

    expect(sql).not.toContain("subject_type = 'role'");
    expect(sql).toContain("s.subject_type = 'user' AND s.subject_id = :userId");
  });

  it('omits the no-actor bypass unless one is asked for', () => {
    const withoutBypass = flat(
      noteVisibilitySql({ alias: 'page', userId: ':userId', roleId: ':roleId' }),
    );
    const withBypass = flat(
      noteVisibilitySql({ userId: '$3', roleId: '$4::int', noActorBypass: '$3::int IS NULL' }),
    );

    // Specifically the bypass, not just any "IS NULL OR": the grant expiry clause reads
    // `s.expires_at IS NULL OR ...` and is present in both.
    expect(withoutBypass).not.toContain('::int IS NULL');
    expect(withoutBypass.startsWith("( page.visibility = 'team'")).toBe(true);
    expect(withBypass).toContain('$3::int IS NULL OR');
  });

  it('prefixes every column when an alias is given and none when it is not', () => {
    const aliased = flat(noteVisibilitySql({ alias: 'page', userId: ':userId', roleId: ':roleId' }));
    const bare = flat(noteVisibilitySql({ userId: '$3', roleId: '$4::int' }));

    expect(aliased).toContain('page.visibility');
    expect(aliased).toContain('page.owner_id');
    expect(aliased).toContain('page.id IN');

    expect(bare).toContain("visibility = 'team'");
    expect(bare).not.toContain('page.');
  });
});

/**
 * The guard this whole file exists for.
 *
 * The list queries build the rule through the query builder; the full-text search cannot
 * (ts_rank has no builder equivalent) and renders it as raw SQL. They used to be two
 * hand-written copies, and the comment on the second one admitted it was "the one place it
 * can silently drift out of step".
 *
 * Normalising away the two things that legitimately differ — the table alias and the
 * parameter syntax — must leave exactly the same rule. If someone changes one call site's
 * options without the other, or special-cases the logic for one of them, this fails.
 */
describe('the two renderings are the same rule', () => {
  const normalise = (sql: string) =>
    flat(sql)
      .replace(/page\./g, '')
      .replace(/:userId|\$3/g, '<user>')
      .replace(/:roleId|\$4::int/g, '<role>');

  it('matches between the query builder and the search, for a caller with a role', () => {
    const builder = NotesRepository.visibleCondition(7);
    const search = noteVisibilitySql({ userId: '$3', roleId: '$4::int' });

    expect(normalise(search)).toBe(normalise(builder));
  });

  it('differs from the search only by the no-actor bypass', () => {
    const builder = NotesRepository.visibleCondition(7);
    const search = noteVisibilitySql({
      userId: '$3',
      roleId: '$4::int',
      noActorBypass: '$3::int IS NULL',
    });

    // The bypass is the search's own concern: the builder handles a missing caller by not
    // applying the rule at all (see NotesRepository.applyVisibility).
    expect(normalise(search)).toBe(normalise(builder).replace('( ', '( <user>::int IS NULL OR '));
  });

  it('matches for a caller with no role too', () => {
    const builder = NotesRepository.visibleCondition(null);
    const search = noteVisibilitySql({ userId: '$3', roleId: null });

    expect(normalise(search)).toBe(normalise(builder));
  });
});
