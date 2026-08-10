-- Generic in-app notification center. TypeORM runs with synchronize: false, so this
-- statement must be applied manually against Supabase (SQL editor or psql). Safe to
-- re-run: idempotent.
--
-- Today only the tasks feature produces rows here (see TaskNotificationsListener), but
-- the shape carries other sources later (note mentions, share grants) without a schema
-- change: `kind` distinguishes the event, `payload` carries whatever that kind needs
-- to render, and entity_kind/entity_id point at the record it's about, not tasks
-- specifically.
--
-- Depends on users(id) — apply create-users-tables.sql first if it hasn't run yet.

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(40) NOT NULL,
  -- Null when the system generated it (a due-date digest has no human actor).
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_kind VARCHAR(20),
  entity_id   INTEGER,
  -- Denormalized title/status so the bell renders without joining the source row, and
  -- still reads correctly after the task behind it is renamed or deleted.
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);
