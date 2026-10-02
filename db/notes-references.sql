-- Note references: notes stop being leaves and become nodes in the CRM graph.
--
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- One table carries both directions of the relationship, because they are the same
-- fact asked from two ends:
--   * forwards  — "what does this note point at"      (note_page_id -> target)
--   * backwards — "what notes point at this lead"     (target -> note_page_id)
-- A second table for backlinks would be the same rows indexed differently, and the
-- two would drift the first time a note was deleted.
--
-- `origin` is what makes one table enough for two features that look alike but are
-- maintained in opposite ways:
--   * 'inline'   — an @mention or [[wikilink]] inside the document. DERIVED: every
--                  content save deletes the page's inline rows and rewrites them from
--                  the TipTap doc, so the document is always the source of truth and
--                  deleting a chip really drops the reference.
--   * 'relation' — an explicit relation pinned in the note header. AUTHORED: it
--                  survives content edits and is only changed by the relation
--                  endpoints.
-- Mixing them would mean either losing pinned relations on every keystroke, or
-- resurrecting mentions the user just deleted.

-- --------------------------------------------------------------------------
-- 1. The table
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS note_references (
  id             SERIAL PRIMARY KEY,
  note_page_id   INTEGER      NOT NULL REFERENCES note_pages(id) ON DELETE CASCADE,
  -- No FK: target_id points into one of seven tables depending on target_kind, which
  -- Postgres cannot express as a single constraint. Rows therefore outlive their
  -- target, and label_snapshot is what keeps a deleted lead's mention readable
  -- instead of blank. Reads resolve the live label and fall back to the snapshot.
  target_kind    VARCHAR(16)  NOT NULL,
  target_id      INTEGER      NOT NULL,
  origin         VARCHAR(10)  NOT NULL,
  label_snapshot VARCHAR(255),
  created_by_id  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_references_kind_check') THEN
    ALTER TABLE note_references ADD CONSTRAINT note_references_kind_check
      CHECK (target_kind IN ('lead', 'project', 'contact', 'company', 'task', 'user', 'note'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_references_origin_check') THEN
    ALTER TABLE note_references ADD CONSTRAINT note_references_origin_check
      CHECK (origin IN ('inline', 'relation'));
  END IF;

  -- A note that cites itself would render as its own backlink, which reads as a bug
  -- every single time. Rejected at the column level so no code path can write one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_references_no_self_check') THEN
    ALTER TABLE note_references ADD CONSTRAINT note_references_no_self_check
      CHECK (NOT (target_kind = 'note' AND target_id = note_page_id));
  END IF;
END $$;

-- Mentioning the same lead in three paragraphs is one reference, not three: the chip
-- is a pointer, and a backlink list that repeated it three times would be noise. The
-- count of mentions is recoverable from the document itself if it is ever wanted.
-- `origin` is part of the key so a pinned relation and an inline mention of the same
-- target coexist — the header chip must not vanish because the body also mentions it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_references
  ON note_references (note_page_id, target_kind, target_id, origin);

-- The backlink query ("which notes mention lead 42") leads on these two columns.
CREATE INDEX IF NOT EXISTS idx_note_references_target
  ON note_references (target_kind, target_id);

-- --------------------------------------------------------------------------
-- 2. Backfill from the single entity link
--
-- note_pages.entity_kind/entity_id held at most one attached record per note. Those
-- become ordinary pinned relations, so nothing that was linked before this migration
-- looks unlinked after it.
--
-- The columns stay, and stay written: they are the denormalized "primary relation"
-- that /notes/by-entity, the note tree badges and the MCP tools already read. The
-- authoritative set is this table; NoteReferencesService is the only writer of both
-- and keeps them in step.
-- --------------------------------------------------------------------------

INSERT INTO note_references (note_page_id, target_kind, target_id, origin, created_by_id, created_at)
SELECT p.id, p.entity_kind, p.entity_id, 'relation', p.created_by_id, p.created_at
FROM note_pages p
WHERE p.entity_kind IS NOT NULL
  AND p.entity_id IS NOT NULL
  AND p.entity_kind IN ('lead', 'project', 'contact', 'company')
ON CONFLICT (note_page_id, target_kind, target_id, origin) DO NOTHING;

-- --------------------------------------------------------------------------
-- 3. Backfill inline references from documents written before mentions existed
--
-- Nothing to do: no document can contain an entityMention or noteLink node yet, and
-- guessing references from prose ("the Johnson job") would invent links nobody made.
-- Inline rows appear the first time each note is saved with a real mention in it.
-- --------------------------------------------------------------------------
