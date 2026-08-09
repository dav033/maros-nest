-- Notes workspace upgrade: authorship, explicit folders, and per-user favorites.
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.

-- --------------------------------------------------------------------------
-- 1. Authorship
--
-- owner_id already records who created a note (see add-note-owner-column.sql) but it
-- doubles as the privacy key, so it can't also carry "who touched this last".
-- created_by_id is seeded from it; last_edited_by_id starts equal to the creator
-- because no edit history exists for rows written before this migration.
-- --------------------------------------------------------------------------

ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS created_by_id     INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS last_edited_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE note_pages SET created_by_id     = owner_id      WHERE created_by_id     IS NULL AND owner_id      IS NOT NULL;
-- The created_by_id IS NOT NULL guard keeps a re-run from pointlessly rewriting the
-- legacy rows that have no creator to inherit from.
UPDATE note_pages SET last_edited_by_id = created_by_id WHERE last_edited_by_id IS NULL AND created_by_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_note_pages_last_editor ON note_pages (last_edited_by_id);

-- --------------------------------------------------------------------------
-- 2. Explicit folders
--
-- Folders group pages and have no document of their own. Nesting a page under another
-- page keeps working exactly as before — nothing is auto-converted, existing rows all
-- default to 'page'.
-- --------------------------------------------------------------------------

ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'page';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'note_pages_kind_check'
  ) THEN
    ALTER TABLE note_pages
      ADD CONSTRAINT note_pages_kind_check CHECK (kind IN ('page', 'folder'));
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3. Per-user favorites
--
-- note_pages.is_favorite was global: one user starring a note starred it for everyone.
-- The new join table makes favorites personal.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS note_page_favorites (
  note_page_id INTEGER NOT NULL REFERENCES note_pages(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (note_page_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_note_page_favorites_user ON note_page_favorites (user_id);

-- Every active user currently sees these notes starred, so give every active user the
-- row: nobody opens the app to find their favorites list emptied.
INSERT INTO note_page_favorites (note_page_id, user_id)
SELECT p.id, u.id
FROM note_pages p
CROSS JOIN users u
WHERE p.is_favorite = true
  AND u.is_active = true
ON CONFLICT DO NOTHING;

-- note_pages.is_favorite is intentionally NOT dropped here. The application stops
-- writing it from this release on; it stays as a rollback-safe snapshot of the old
-- global state and gets dropped in a later cleanup once this schema is proven.
