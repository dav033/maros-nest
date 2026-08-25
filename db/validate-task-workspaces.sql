-- Read-only validation for create/migrate-task-workspaces.sql.
-- Every statement is safe to run repeatedly and returns a small diagnostic result.

SELECT 'general_workspace_count' AS check_name, count(*) AS value
FROM task_workspaces WHERE system_key = 'general';

SELECT 'duplicate_canonical_workspaces' AS check_name, count(*) AS value
FROM (
  SELECT canonical_job_lead_id FROM task_workspaces
  WHERE canonical_job_lead_id IS NOT NULL
  GROUP BY canonical_job_lead_id HAVING count(*) > 1
) duplicates;

SELECT 'tasks_with_invalid_folder_owner' AS check_name, count(*) AS value
FROM tasks t
JOIN task_workspace_folders f ON f.id = t.folder_id
WHERE t.workspace_id IS DISTINCT FROM f.workspace_id;

SELECT 'files_with_invalid_owner' AS check_name, count(*) AS value
FROM task_files
WHERE (task_id IS NULL) = (workspace_id IS NULL);

SELECT 'pending_files_older_than_24h' AS check_name, count(*) AS value
FROM task_files
WHERE status = 'pending' AND deleted_at IS NULL
  AND updated_at < now() - interval '24 hours';

SELECT 'unassigned_tasks' AS check_name, count(*) AS value
FROM tasks WHERE deleted_at IS NULL AND workspace_id IS NULL;

-- Compatibility check: legacy attachment arrays are still retained and may be
-- compared with task_files after the backfill has been run.
SELECT 'legacy_attachment_rows' AS check_name, count(*) AS value
FROM tasks
WHERE jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) > 0;

