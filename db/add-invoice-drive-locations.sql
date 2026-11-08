-- Invoice index (REQ-006 T6): where each invoice document lives in Google Drive,
-- its processing state, and the history of every change. One row per Drive file.
-- Safe to re-run. Apply by hand (agents never touch the shared database).
--
-- The API tolerates this table being absent: filing and searching keep working,
-- they just do not record or show locations until this is applied.

CREATE TABLE IF NOT EXISTS public.invoice_document_locations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_scan_id uuid NOT NULL REFERENCES public.invoice_scans(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  drive_url     text,
  drive_name    varchar(255) NOT NULL,
  drive_folder  varchar(500) NOT NULL,
  -- in_receipts: just filed. categorized: Alexandra categorised it.
  -- moved: moved to its final folder. removed: no longer in Drive.
  status        varchar(20) NOT NULL DEFAULT 'in_receipts',
  received_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_document_locations_status_check
    CHECK (status IN ('in_receipts', 'categorized', 'moved', 'removed')),
  CONSTRAINT invoice_document_locations_drive_file_unique UNIQUE (drive_file_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_document_locations_scan
  ON public.invoice_document_locations (invoice_scan_id);

CREATE INDEX IF NOT EXISTS idx_invoice_document_locations_status
  ON public.invoice_document_locations (status);

-- Append-only history: a location is updated in place, but every change leaves a row here.
CREATE TABLE IF NOT EXISTS public.invoice_document_events (
  id          bigserial PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES public.invoice_document_locations(id) ON DELETE CASCADE,
  from_status varchar(20),
  to_status   varchar(20) NOT NULL,
  drive_folder varchar(500),
  note        text,
  -- Who or what made the change: an email, or 'mcp' / 'system'.
  actor       varchar(255) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_document_events_location
  ON public.invoice_document_events (location_id, created_at);
