-- Reviewer comments and last editor of invoice scans, shown in the tables.
-- Safe to re-run.
ALTER TABLE public.invoice_scans
  ADD COLUMN IF NOT EXISTS comments text,
  ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES public.users(id) ON DELETE SET NULL;
