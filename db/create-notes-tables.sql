-- Mini-Notion notes feature: hierarchical pages with a TipTap JSON document per page.
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.

CREATE TABLE IF NOT EXISTS note_pages (
  id            SERIAL PRIMARY KEY,
  parent_id     INTEGER REFERENCES note_pages(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL DEFAULT 'Untitled',
  icon          VARCHAR(50),
  content       JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_text  TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  is_favorite   BOOLEAN NOT NULL DEFAULT false,
  entity_kind   VARCHAR(20),
  entity_id     INTEGER,
  deleted_at    TIMESTAMP,
  -- Set to the id of the page the user actually trashed (which may be an ancestor).
  -- Lets restore bring back only that subtree, without resurrecting a descendant that
  -- was already independently trashed before its parent was.
  trashed_root_id INTEGER,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_pages_parent ON note_pages (parent_id);
CREATE INDEX IF NOT EXISTS idx_note_pages_entity ON note_pages (entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_note_pages_trashed_root ON note_pages (trashed_root_id);

-- Full-text search over title + extracted plain text of the TipTap doc.
-- content_text is populated by the service layer at write time (walking the JSON tree).
-- 'simple' dictionary avoids English/Spanish-specific stemming assumptions.
ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content_text, '')), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_note_pages_tsv ON note_pages USING GIN (content_tsv);

CREATE TABLE IF NOT EXISTS note_tags (
  id     SERIAL PRIMARY KEY,
  name   VARCHAR(50) NOT NULL UNIQUE,
  color  VARCHAR(20) NOT NULL DEFAULT 'neutral'
);

CREATE TABLE IF NOT EXISTS note_page_tags (
  note_page_id INTEGER NOT NULL REFERENCES note_pages(id) ON DELETE CASCADE,
  note_tag_id  INTEGER NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_page_id, note_tag_id)
);
