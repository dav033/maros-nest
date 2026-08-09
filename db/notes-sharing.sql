-- Notes sharing: explicit visibility, per-person grants, and public share links.
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- Applying this file changes NOTHING for any user. The backfill in section 1 reproduces
-- the existing implicit privacy rule exactly; every new table starts empty.

-- --------------------------------------------------------------------------
-- 1. Explicit visibility
--
-- Privacy used to be an emergent property of two columns kept for other purposes:
-- a note was private iff entity_kind IS NULL AND owner_id IS NOT NULL. That coupling
-- is why unlinking a note from a lead had to clear owner_id (otherwise it silently
-- became someone else's private note). A real column ends the coupling.
--
-- 'public' is deliberately NOT a value here: being published is a property of a link
-- (see note_page_links), not of the note. One note can carry two links with different
-- expiries, and unpublishing must not touch who inside the company can read it.
-- --------------------------------------------------------------------------

-- Added nullable on purpose: "NULL" is what marks a row as not yet backfilled, which is
-- what makes the whole file safe to re-run. A NOT NULL DEFAULT 'team' column would give
-- every row a value immediately and leave the backfill below no way to tell an
-- un-migrated row from one a user deliberately set to 'team' — a second run would flip
-- those back to 'private'. NOT NULL is applied at the end, once every row has a value.
ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS visibility VARCHAR(12);

-- Literal translation of isPrivateNote() in note-access.util.ts, so day one nobody
-- sees a change. Eyeball the split before committing to it if you like:
--   SELECT visibility, count(*) FROM note_pages GROUP BY visibility;
UPDATE note_pages
SET visibility = CASE
  WHEN entity_kind IS NULL AND owner_id IS NOT NULL THEN 'private'
  ELSE 'team'
END
WHERE visibility IS NULL;

ALTER TABLE note_pages ALTER COLUMN visibility SET DEFAULT 'team';
ALTER TABLE note_pages ALTER COLUMN visibility SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'note_pages_visibility_check'
  ) THEN
    ALTER TABLE note_pages
      ADD CONSTRAINT note_pages_visibility_check CHECK (visibility IN ('private', 'team'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_note_pages_visibility ON note_pages (visibility);

-- --------------------------------------------------------------------------
-- 2. Per-person (or per-role) grants
--
-- subject_id is polymorphic — a users.id or a roles.id depending on subject_type — so
-- it carries no FK. NoteSharingMaintenanceCron sweeps rows whose subject no longer
-- exists; until it runs, the join simply finds nothing and access fails closed.
--
-- A grant on a folder is inherited by its whole subtree. Never upward: seeing a child
-- must not reveal its parent.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS note_page_shares (
  id            SERIAL PRIMARY KEY,
  note_page_id  INTEGER NOT NULL REFERENCES note_pages(id) ON DELETE CASCADE,
  subject_type  VARCHAR(10) NOT NULL,
  subject_id    INTEGER NOT NULL,
  access        VARCHAR(10) NOT NULL,
  granted_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at    TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT note_page_shares_subject_check CHECK (subject_type IN ('user', 'role')),
  CONSTRAINT note_page_shares_access_check  CHECK (access IN ('viewer', 'commenter', 'editor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_note_page_shares
  ON note_page_shares (note_page_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_note_page_shares_subject
  ON note_page_shares (subject_type, subject_id);

-- --------------------------------------------------------------------------
-- 3. Public share links
--
-- The token is never stored in clear. It is 32 random bytes (base64url) shown once in
-- the URL; only its SHA-256 lives here, so a leaked backup or a logged query hands
-- nobody a working link. Plain SHA-256 rather than bcrypt is deliberate: 256 bits of
-- entropy need no key stretching, and a hash lookup has to hit an index.
--
-- Revocation is soft (revoked_at) so the audit trail of who published what survives it.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS note_page_links (
  id               SERIAL PRIMARY KEY,
  note_page_id     INTEGER NOT NULL REFERENCES note_pages(id) ON DELETE CASCADE,
  token_hash       CHAR(64) NOT NULL,
  -- First few characters of the token, so the UI can tell two links apart without
  -- being able to reconstruct either.
  token_hint       VARCHAR(8) NOT NULL,
  password_hash    TEXT,
  include_children BOOLEAN NOT NULL DEFAULT false,
  allow_indexing   BOOLEAN NOT NULL DEFAULT false,
  show_author      BOOLEAN NOT NULL DEFAULT true,
  expires_at       TIMESTAMP,
  revoked_at       TIMESTAMP,
  view_count       INTEGER NOT NULL DEFAULT 0,
  last_viewed_at   TIMESTAMP,
  created_by_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_note_page_links_token ON note_page_links (token_hash);
CREATE INDEX IF NOT EXISTS idx_note_page_links_page ON note_page_links (note_page_id);
CREATE INDEX IF NOT EXISTS idx_note_page_links_active
  ON note_page_links (revoked_at, expires_at);

-- --------------------------------------------------------------------------
-- 4. View audit
--
-- ip_hash is sha256(ip + NOTE_SHARE_IP_SALT): enough to count unique visitors, never
-- enough to recover an address. Rows older than 90 days are purged by the cron.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS note_page_link_views (
  id         BIGSERIAL PRIMARY KEY,
  link_id    INTEGER NOT NULL REFERENCES note_page_links(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMP NOT NULL DEFAULT now(),
  ip_hash    CHAR(64),
  user_agent VARCHAR(255),
  referer    VARCHAR(512)
);

CREATE INDEX IF NOT EXISTS idx_note_page_link_views_link
  ON note_page_link_views (link_id, viewed_at DESC);

-- --------------------------------------------------------------------------
-- 5. Access requests
--
-- The partial unique index allows one pending request per (page, user) while keeping
-- the full history of resolved ones.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS note_page_access_requests (
  id             SERIAL PRIMARY KEY,
  note_page_id   INTEGER NOT NULL REFERENCES note_pages(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message        VARCHAR(500),
  status         VARCHAR(10) NOT NULL DEFAULT 'pending',
  resolved_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at    TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT note_page_access_requests_status_check
    CHECK (status IN ('pending', 'granted', 'denied'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_note_access_request_pending
  ON note_page_access_requests (note_page_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_note_access_requests_page
  ON note_page_access_requests (note_page_id, status);
