ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS qbo_vendor_id varchar(64),
  ADD COLUMN IF NOT EXISTS qbo_vendor_name varchar(255),
  ADD COLUMN IF NOT EXISTS qbo_vendor_match_confidence double precision,
  ADD COLUMN IF NOT EXISTS qbo_vendor_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS qbo_vendor_last_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'companies_qbo_vendor_match_confidence_range'
      AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_qbo_vendor_match_confidence_range
      CHECK (
        qbo_vendor_match_confidence IS NULL
        OR (qbo_vendor_match_confidence >= 0 AND qbo_vendor_match_confidence <= 1)
      )
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_qbo_vendor_id
  ON public.companies (qbo_vendor_id)
  WHERE qbo_vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_qbo_vendor_match_type
  ON public.companies (type)
  WHERE type IN ('SUPPLIER', 'SUBCONTRACTOR');
