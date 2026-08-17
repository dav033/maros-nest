-- Task assignment feature: tasks with an internal assignee, a status board, comments
-- and an activity log. TypeORM runs with synchronize: false, so these statements must
-- be applied manually against Supabase (SQL editor or psql). Safe to re-run: everything
-- is idempotent.
--
-- Depends on users(id) and roles(id)/role_permissions — apply create-users-tables.sql
-- first if it hasn't run yet.

CREATE TABLE IF NOT EXISTS tasks (
  id                  SERIAL PRIMARY KEY,
  -- One level only: a subtask cannot itself have subtasks (enforced in TasksService).
  parent_id           INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title               VARCHAR(255) NOT NULL DEFAULT 'Untitled task',
  description         JSONB NOT NULL DEFAULT '{}'::jsonb,
  description_text    TEXT,
  kind                VARCHAR(24) NOT NULL DEFAULT 'general',
  status              VARCHAR(16) NOT NULL DEFAULT 'todo',
  priority            VARCHAR(10) NOT NULL DEFAULT 'normal',
  -- Order within the status column. Sparse (multiples of 1000), rebalanced on collapse.
  position            INTEGER NOT NULL DEFAULT 0,
  assignee_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Who is accountable for the task getting done, independent of who executes it.
  -- Defaults to the creator and keeps receiving due/overdue notices even while unassigned.
  reporter_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_kind         VARCHAR(20),
  entity_id           INTEGER,
  start_date          DATE,
  due_date            DATE,
  -- Required whenever status = 'blocked'. A blocked task with no reason is noise.
  blocked_reason      TEXT,
  -- First transition to blocked; edits while blocked must not reset escalation.
  blocked_at          TIMESTAMP,
  -- Required when status = 'cancelled'. A closed task should retain its rationale.
  cancelled_reason    TEXT,
  completed_at        TIMESTAMP,
  attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at          TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT tasks_blocked_needs_reason
    CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_tasks_board
  ON tasks (status, position) WHERE deleted_at IS NULL AND parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee
  ON tasks (assignee_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_entity
  ON tasks (entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due
  ON tasks (due_date) WHERE deleted_at IS NULL AND status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id);

-- Same search approach as note_pages: description_text is populated by the service
-- layer at write time (walking the TipTap tree). 'simple' dictionary avoids
-- English/Spanish-specific stemming assumptions.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description_text, '')), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_tasks_tsv ON tasks USING GIN (content_tsv);

CREATE TABLE IF NOT EXISTS task_labels (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(50) NOT NULL UNIQUE,
  color VARCHAR(20) NOT NULL DEFAULT 'neutral'
);

CREATE TABLE IF NOT EXISTS task_label_links (
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_text  TEXT,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id, created_at);

-- Append-only. Never updated, never deleted except by the task's cascade.
CREATE TABLE IF NOT EXISTS task_activity (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       VARCHAR(32) NOT NULL,
  from_value TEXT,
  to_value   TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity (task_id, created_at DESC);

-- Who gets notified. Seeded with reporter + assignee, grows with whoever comments.
CREATE TABLE IF NOT EXISTS task_watchers (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_watchers_user ON task_watchers (user_id);

INSERT INTO task_labels (name, color) VALUES
  ('Urgente', 'red'),
  ('Cliente espera', 'amber'),
  ('Esperando material', 'blue'),
  ('Esperando clima', 'sky'),
  ('Requiere aprobación', 'violet')
ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- Grant the new permissions to 'member'.
--
-- 'admin' is deliberately absent: the permission resolver treats the admin
-- system role as holding the entire catalog in code, so it picks tasks:* up
-- without a row here — see UsersService.effectivePermissions.
-- --------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES ('tasks:read'), ('tasks:write'), ('tasks:delete')) AS p(permission)
WHERE r.name = 'member'
ON CONFLICT (role_id, permission) DO NOTHING;
