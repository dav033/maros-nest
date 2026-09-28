-- Lets Invoice Scans hold manually entered cash transactions without a file.
-- Safe to re-run.
ALTER TABLE public.invoice_scans
  ADD COLUMN IF NOT EXISTS record_type varchar(20) NOT NULL DEFAULT 'invoice',
  ALTER COLUMN file_key DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.invoice_scans'::regclass
      AND conname = 'invoice_scans_record_type_check'
  ) THEN
    ALTER TABLE public.invoice_scans
      ADD CONSTRAINT invoice_scans_record_type_check
      CHECK (record_type IN ('invoice', 'transaction'));
  END IF;
END $$;
