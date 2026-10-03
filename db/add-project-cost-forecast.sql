-- What the team expects a project to end up costing, by category.
--
-- TypeORM runs with synchronize: false, so these statements are applied by hand against
-- Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- WHY. Everything the CRM knows about job cost is what already happened: QuickBooks tells
-- us the 032P-0825 has consumed 190,586.43 in cash, of which 105,600.23 is materials and
-- 78,840.63 subcontractors. Nothing records what it is *expected* to end up costing, so
-- there is no way to see a job heading past its budget while there is still time to act —
-- the overrun only shows up once it is paid.
--
-- That expectation is a judgement, not a derivation: it comes from whoever is running the
-- job, and no QuickBooks figure implies it. So it is stored, and only here.
--
-- Deliberately one figure per category and not per vendor. The 032P-0825 alone touches 30
-- vendors, several of them one-off purchases that appear after the fact; a forecast per
-- vendor would be mostly empty rows that nobody maintains, and an empty row reads as "zero
-- expected" when it means "nobody said". The per-vendor detail stays on the actuals side,
-- which QuickBooks can answer on its own.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS forecast_material_cost      NUMERIC(12,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS forecast_subcontractor_cost NUMERIC(12,2);

-- Who last touched the forecast and when. A forecast is only worth comparing against the
-- actuals if you can tell whether it was written before the job started or last week, and
-- a stale forecast is the one that quietly stops being a warning.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS forecast_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.forecast_material_cost IS
  'What the team expects this project to end up costing in construction materials (QuickBooks account 50400). NULL means nobody recorded it, which is not 0.';

COMMENT ON COLUMN projects.forecast_subcontractor_cost IS
  'What the team expects this project to end up costing in subcontractors (QuickBooks account 53600). NULL means nobody recorded it, which is not 0.';

COMMENT ON COLUMN projects.forecast_updated_at IS
  'When either forecast figure was last written. Lets the screen say how old the expectation is.';

-- No CHECK on the sign. A forecast is a number somebody typed, and rejecting it at the
-- database would surface as a 500 on a form rather than as a message next to the field;
-- the DTO validates it where the user can see the answer.

-- --------------------------------------------------------------------------
-- Backfill
--
-- None, and deliberately. The obvious temptation is to seed the forecast with what the job
-- has already cost, or with a slice of the estimate — but both would be this migration
-- inventing an expectation nobody held, and it would then be reported on as if somebody
-- had. Every row starts NULL, and the screen says "sin pronóstico" until a person types
-- one.
-- --------------------------------------------------------------------------
