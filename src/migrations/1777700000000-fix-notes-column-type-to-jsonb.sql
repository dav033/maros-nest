-- Fix notes column type from text to jsonb for companies, contacts, and leads
-- Uses a helper function to safely cast; invalid JSON values become NULL

CREATE OR REPLACE FUNCTION pg_temp.safe_to_jsonb(val text) RETURNS jsonb AS $$
BEGIN
  RETURN val::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE public.companies
  ALTER COLUMN notes TYPE jsonb
  USING pg_temp.safe_to_jsonb(notes);

ALTER TABLE public.contacts
  ALTER COLUMN notes TYPE jsonb
  USING pg_temp.safe_to_jsonb(notes);

ALTER TABLE public.leads
  ALTER COLUMN notes TYPE jsonb
  USING pg_temp.safe_to_jsonb(notes);
