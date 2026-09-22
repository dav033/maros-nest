-- Links an invoice scan to a project by its number (leads.lead_number).
-- Safe to re-run.
ALTER TABLE public.invoice_scans
  ADD COLUMN IF NOT EXISTS project_number VARCHAR(50);
