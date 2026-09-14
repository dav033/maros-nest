-- Invoice photos and AI extractions. Access is restricted to the Nest API;
-- clients must not read invoice images or financial data through PostgREST.
CREATE TABLE IF NOT EXISTS public.invoice_scans (
  id uuid PRIMARY KEY,
  file_key text NOT NULL,
  file_name varchar(255) NOT NULL,
  content_type varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'needs_review', 'failed')),
  extracted_data jsonb,
  qbo_suggestions jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_scans_created_at
  ON public.invoice_scans (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_scans_status
  ON public.invoice_scans (status);

ALTER TABLE public.invoice_scans ENABLE ROW LEVEL SECURITY;
