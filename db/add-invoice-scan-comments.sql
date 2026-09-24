-- Reviewer comments on invoice scans, shown in the pending/completed tables.
-- Safe to re-run.
ALTER TABLE public.invoice_scans
  ADD COLUMN IF NOT EXISTS comments text;
