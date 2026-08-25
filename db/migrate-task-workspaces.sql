-- Idempotent historical backfill for task workspaces.
-- Run only after create-task-workspaces.sql and after the CRM tables exist.
-- The legacy attachments JSONB is intentionally retained; task_files becomes
-- the managed-file source for new reads and the old array remains a rollback aid.

BEGIN;

INSERT INTO task_workspaces (
  title, workspace_type, canonical_job_lead_id, created_by_id
)
SELECT
  left(coalesce(nullif(btrim(l.lead_number), ''), nullif(btrim(l.name), ''), 'Lead ' || l.id) || ' Workspace', 160),
  'custom',
  l.id,
  NULL
FROM leads l
ON CONFLICT (canonical_job_lead_id) DO NOTHING;

INSERT INTO task_workspace_links (workspace_id, entity_kind, entity_id, relationship)
SELECT w.id, 'lead', w.canonical_job_lead_id, 'primary'
FROM task_workspaces w
WHERE w.canonical_job_lead_id IS NOT NULL
ON CONFLICT (workspace_id, entity_kind, entity_id) DO NOTHING;

INSERT INTO task_workspace_links (workspace_id, entity_kind, entity_id, relationship)
SELECT w.id, 'project', p.id, 'related'
FROM projects p
JOIN task_workspaces w ON w.canonical_job_lead_id = p.lead_id
WHERE p.lead_id IS NOT NULL
ON CONFLICT (workspace_id, entity_kind, entity_id) DO NOTHING;

INSERT INTO task_workspace_links (workspace_id, entity_kind, entity_id, relationship)
SELECT DISTINCT w.id, 'contact', l.contact_id, 'contact'
FROM leads l
JOIN task_workspaces w ON w.canonical_job_lead_id = l.id
WHERE l.contact_id IS NOT NULL
ON CONFLICT (workspace_id, entity_kind, entity_id) DO NOTHING;

INSERT INTO task_workspace_links (workspace_id, entity_kind, entity_id, relationship)
SELECT DISTINCT w.id, 'company', c.company_id, 'client'
FROM leads l
JOIN task_workspaces w ON w.canonical_job_lead_id = l.id
JOIN contacts c ON c.id = l.contact_id
WHERE c.company_id IS NOT NULL
ON CONFLICT (workspace_id, entity_kind, entity_id) DO NOTHING;

UPDATE tasks t
SET workspace_id = COALESCE(
      (
        SELECT w.id
        FROM task_workspaces w
        WHERE t.entity_kind = 'lead'
          AND w.canonical_job_lead_id = t.entity_id
        LIMIT 1
      ),
      (
        SELECT w.id
        FROM projects p
        JOIN task_workspaces w ON w.canonical_job_lead_id = p.lead_id
        WHERE t.entity_kind = 'project'
          AND p.id = t.entity_id
        LIMIT 1
      ),
      (
        SELECT l.workspace_id
        FROM task_workspace_links l
        WHERE l.entity_kind = t.entity_kind
          AND l.entity_id = t.entity_id
        ORDER BY l.workspace_id
        LIMIT 1
      ),
      general_workspace.id
    ),
    folder_id = NULL,
    workspace_position = COALESCE(t.workspace_position, 1000)
FROM task_workspaces general_workspace
WHERE general_workspace.system_key = 'general'
  AND t.workspace_id IS NULL;

-- Convert every legacy S3 key into a managed file without deleting the old array.
INSERT INTO task_files (
  task_id, s3_key, file_name, mime_type, size_bytes, position,
  status, client_upload_id
)
SELECT
  t.id,
  legacy.key,
  right(regexp_replace(legacy.key, '^.*/', ''), 255),
  'application/octet-stream',
  0,
  legacy.position,
  'ready',
  left('legacy-task-' || t.id || '-' || md5(legacy.key), 160)
FROM tasks t
CROSS JOIN LATERAL (
  SELECT value AS key, row_number() OVER () * 1000 AS position
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(t.attachments) = 'array' THEN t.attachments ELSE '[]'::jsonb END
  )
) legacy
WHERE t.deleted_at IS NULL
  AND t.workspace_id IS NOT NULL
  AND legacy.key <> ''
ON CONFLICT DO NOTHING;

COMMIT;
