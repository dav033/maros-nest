ALTER TABLE public.projects
  DROP COLUMN IF EXISTS invoice_amount,
  DROP COLUMN IF EXISTS invoice_status,
  DROP COLUMN IF EXISTS payments;
