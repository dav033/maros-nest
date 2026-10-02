/**
 * The one definition of "which notes may this caller see".
 *
 * It used to exist twice: once built with the query builder for every list query, and
 * once hand-copied into the raw SQL of the full-text search, which needs ts_rank and so
 * cannot go through the builder. The copy carried a comment admitting it was "the one
 * place it can silently drift out of step" — and the failure it invites is quiet: a note
 * someone was just granted stops turning up in search while still appearing in the tree,
 * or worse, the reverse.
 *
 * The rule itself: a note is visible when it is a team note, when the caller owns it, or
 * when a grant on it or on any ancestor reaches the caller (grants are inherited
 * downward, which is what the recursive CTE walks). Expiry is honoured.
 *
 * The call sites genuinely differ in how they can refer to things — named parameters vs
 * positional, an aliased table vs a bare one, and whether Postgres can infer a
 * parameter's type without a cast. Those differences are declared as options here
 * instead of being a reason to keep two copies of the logic.
 */
export interface NoteVisibilityOptions {
  /**
   * Alias of note_pages in the host query (`page` for the query builder). Omitted for a
   * query that selects from the table unaliased, like the search.
   */
  alias?: string;
  /** How the host query refers to the caller's user id — `:userId` or `$3`. */
  userId: string;
  /**
   * Same for the caller's role id. `null` when the caller has no role at all, which drops
   * the role arm instead of comparing against a null that could never match.
   */
  roleId: string | null;
  /**
   * An expression that is true when there is no caller — MCP's shared token, which is
   * deliberately trusted with everything (see NoteAccessService). Needs a cast on most
   * drivers, hence a caller-supplied expression rather than a flag: `$3::int IS NULL`.
   *
   * Omitted by callers that instead skip applying the rule altogether.
   */
  noActorBypass?: string;
}

export function noteVisibilitySql({
  alias,
  userId,
  roleId,
  noActorBypass,
}: NoteVisibilityOptions): string {
  const column = (name: string) => (alias ? `${alias}.${name}` : name);

  const subjectMatch =
    roleId === null
      ? `s.subject_type = 'user' AND s.subject_id = ${userId}`
      : `(
             (s.subject_type = 'user' AND s.subject_id = ${userId})
          OR (s.subject_type = 'role' AND s.subject_id = ${roleId})
         )`;

  const arms = [
    ...(noActorBypass ? [noActorBypass] : []),
    `${column('visibility')} = 'team'`,
    `${column('owner_id')} = ${userId}`,
    `${column('id')} IN (
        WITH RECURSIVE granted AS (
          SELECT s.note_page_id AS id
          FROM note_page_shares s
          WHERE ${subjectMatch}
            AND (s.expires_at IS NULL OR s.expires_at > now())
          UNION
          SELECT c.id FROM note_pages c JOIN granted g ON c.parent_id = g.id
        )
        SELECT id FROM granted
      )`,
  ];

  return `(\n      ${arms.join('\n      OR ')}\n    )`;
}
