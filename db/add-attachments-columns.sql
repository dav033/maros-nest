-- Feature 1D: add attachments jsonb column to companies, contacts, projects.
-- TypeORM runs with synchronize: false, so these ALTERs must be applied manually.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE projects  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
