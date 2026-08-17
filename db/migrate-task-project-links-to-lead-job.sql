-- Canonical job identity for tasks: a project is the execution record of a lead.
-- Safe to run repeatedly; rows without a resolvable lead are left untouched.
UPDATE tasks t
SET entity_kind = 'lead',
    entity_id = p.lead_id
FROM projects p
WHERE t.entity_kind = 'project'
  AND t.entity_id = p.id
  AND p.lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_job_entity
  ON tasks (entity_kind, entity_id)
  WHERE deleted_at IS NULL;
