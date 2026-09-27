-- Run once before deploying the QuickBooks project importer.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS qbo_customer_id varchar(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_qbo_customer_id_unique
  ON projects (qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;
