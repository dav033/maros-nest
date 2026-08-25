-- Additive task workspaces, folders and managed files.
-- Apply after create-tasks-tables.sql, create-users-tables.sql and the CRM tables.
-- This script intentionally does not backfill historical tasks. That belongs to the
-- separately guarded migrate-task-workspaces.sql script.

CREATE TABLE IF NOT EXISTS task_workspaces (
  id                    SERIAL PRIMARY KEY,
  title                 VARCHAR(160) NOT NULL,
  description           JSONB,
  description_text      TEXT,
  workspace_type        VARCHAR(24) NOT NULL DEFAULT 'custom',
  system_key            VARCHAR(120) UNIQUE,
  canonical_job_lead_id INTEGER UNIQUE REFERENCES leads(id) ON DELETE SET NULL,
  created_by_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archived_at           TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT task_workspaces_title_nonempty CHECK (length(btrim(title)) > 0),
  CONSTRAINT task_workspaces_type_check CHECK (workspace_type IN ('system_default', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_task_workspaces_active_title
  ON task_workspaces (archived_at, lower(title));
CREATE INDEX IF NOT EXISTS idx_task_workspaces_description_tsv
  ON task_workspaces USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description_text, '')));
CREATE INDEX IF NOT EXISTS idx_task_workspaces_lead
  ON task_workspaces (canonical_job_lead_id);

CREATE TABLE IF NOT EXISTS task_workspace_links (
  workspace_id  INTEGER NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  entity_kind   VARCHAR(16) NOT NULL,
  entity_id     INTEGER NOT NULL,
  relationship  VARCHAR(32) NOT NULL DEFAULT 'related',
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entity_kind, entity_id),
  CONSTRAINT task_workspace_links_kind_check
    CHECK (entity_kind IN ('lead', 'project', 'contact', 'company')),
  CONSTRAINT task_workspace_links_relationship_check
    CHECK (relationship IN ('primary', 'related', 'client', 'supplier', 'subcontractor', 'contact'))
);

CREATE INDEX IF NOT EXISTS idx_task_workspace_links_entity
  ON task_workspace_links (entity_kind, entity_id);

CREATE TABLE IF NOT EXISTS task_workspace_folders (
  id                SERIAL PRIMARY KEY,
  workspace_id      INTEGER NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  parent_folder_id  INTEGER REFERENCES task_workspace_folders(id) ON DELETE RESTRICT,
  title             VARCHAR(160) NOT NULL,
  position          NUMERIC(20, 6) NOT NULL DEFAULT 1000,
  created_by_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT task_workspace_folders_title_nonempty CHECK (length(btrim(title)) > 0),
  CONSTRAINT task_workspace_folders_sibling_title_unique UNIQUE (workspace_id, parent_folder_id, title)
);

CREATE INDEX IF NOT EXISTS idx_task_workspace_folders_workspace_position
  ON task_workspace_folders (workspace_id, parent_folder_id, position, id);

CREATE TABLE IF NOT EXISTS task_files (
  id                 SERIAL PRIMARY KEY,
  task_id            INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id       INTEGER REFERENCES task_workspaces(id) ON DELETE CASCADE,
  s3_key             TEXT NOT NULL UNIQUE,
  file_name          VARCHAR(255) NOT NULL,
  mime_type          VARCHAR(160) NOT NULL,
  size_bytes         BIGINT NOT NULL,
  checksum           VARCHAR(255),
  position           NUMERIC(20, 6) NOT NULL DEFAULT 1000,
  status             VARCHAR(16) NOT NULL DEFAULT 'pending',
  client_upload_id   VARCHAR(160) NOT NULL,
  uploaded_by_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMP,
  CONSTRAINT task_files_one_owner CHECK ((task_id IS NOT NULL) <> (workspace_id IS NOT NULL)),
  CONSTRAINT task_files_status_check CHECK (status IN ('pending', 'ready', 'failed')),
  CONSTRAINT task_files_size_check CHECK (size_bytes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_files_task_client_upload
  ON task_files (task_id, client_upload_id) WHERE task_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_files_workspace_client_upload
  ON task_files (workspace_id, client_upload_id) WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_files_task_position
  ON task_files (task_id, position, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_files_workspace_position
  ON task_files (workspace_id, position, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_files_pending
  ON task_files (status, updated_at) WHERE status = 'pending' AND deleted_at IS NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS folder_id INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_position NUMERIC(20, 6) NOT NULL DEFAULT 1000;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_workspace_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_workspace_fk
      FOREIGN KEY (workspace_id) REFERENCES task_workspaces(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_folder_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_folder_fk
      FOREIGN KEY (folder_id) REFERENCES task_workspace_folders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_scope
  ON tasks (workspace_id, folder_id, workspace_position, id) WHERE deleted_at IS NULL;

INSERT INTO task_workspaces (title, workspace_type, system_key)
VALUES ('General Tasks', 'system_default', 'general')
ON CONFLICT (system_key) DO NOTHING;

