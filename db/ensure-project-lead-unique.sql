-- A lead can own at most one project. This also protects conversion against
-- concurrent requests or application instances running different versions.
-- The statement fails without changing data if duplicates already exist.

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_lead_id_unique
  ON projects (lead_id)
  WHERE lead_id IS NOT NULL;
