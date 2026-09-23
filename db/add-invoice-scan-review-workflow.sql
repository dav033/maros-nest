-- Review workflow for invoice scans: partial-scan warnings, "entered in
-- QuickBooks" checkbox and the timestamps behind the ready/reminder emails.
-- Safe to re-run.
ALTER TABLE public.invoice_scans
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS entered_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- The reminder cron and the "pending" table only ever look at scans that are
-- not entered yet.
CREATE INDEX IF NOT EXISTS idx_invoice_scans_pending
  ON public.invoice_scans (created_at DESC)
  WHERE entered_at IS NULL;
