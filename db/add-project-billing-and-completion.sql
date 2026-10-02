-- Project billing truth and completion date: what was invoiced, what was collected, and when.
--
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- WHY THESE COLUMNS EXIST AT ALL, given that projects.invoice_amount is right there:
-- invoice_amount is not a record of what was billed. In 58 of the 59 projects that have
-- both values it equals leads.estimate to the dollar, so it is a mirror of the estimate
-- that someone copied forward at project creation. Reading it as revenue makes margin
-- per job uncomputable, because cost is compared against an intention, not an outcome.
-- The columns below are the billing truth; invoice_amount stays as legacy and keeps
-- feeding whatever already reads it (110 rows depend on it) and must not be repurposed.

-- --------------------------------------------------------------------------
-- 1. The columns
-- --------------------------------------------------------------------------

-- NUMERIC, not float: these are money and get summed into aging totals, where a
-- binary-float cent error becomes a balance that does not tie out.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billed_amount    NUMERIC(12,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS collected_amount NUMERIC(12,2);

-- DATE, not timestamp: an invoice is dated, not timed, and aging counts whole days.
-- Storing a time of day would make "days outstanding" depend on the hour a clerk typed
-- the row in.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billed_at        DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS paid_at          DATE;

-- NULL is load-bearing on all four and must stay reachable: it is the difference
-- between "collected nothing" (0) and "nobody recorded a collection" (NULL). Defaulting
-- any of them to 0 would turn an unanswered question into a confident zero, which is
-- what the aging report exists to stop.

COMMENT ON COLUMN projects.billed_amount IS
  'What was actually invoiced to the client. NULL = not billed yet / unknown, never 0. Billing truth; invoice_amount is a legacy mirror of leads.estimate.';
COMMENT ON COLUMN projects.collected_amount IS
  'What the client actually paid against billed_amount. NULL = nothing recorded, which is not the same as 0.';
COMMENT ON COLUMN projects.billed_at IS
  'Invoice date. Start of the aging clock; the report falls back to end_date when this is NULL.';
COMMENT ON COLUMN projects.paid_at IS
  'Date the collection closed. Set alongside collected_amount reaching billed_amount.';
COMMENT ON COLUMN projects.invoice_amount IS
  'LEGACY: a copy of leads.estimate made at project creation, not an invoiced total (58/59 match to the dollar). Kept because existing reads depend on it. Use billed_amount for anything financial.';

-- --------------------------------------------------------------------------
-- 2. Index for the aging query
--
-- GET /projects/receivables asks one question: among COMPLETED projects, how old is
-- each uncollected balance. Partial on the status so the index holds only the few dozen
-- rows the report can ever return instead of all 110+, and carrying both aging dates
-- means the planner reads the clock without touching the heap.
--
-- Deliberately not indexing on COALESCE(billed_at, end_date): end_date is a timestamp,
-- and a cast to date inside an index expression is only immutable while the column
-- stays timestamp WITHOUT time zone — a schema change would then fail at ALTER with a
-- confusing error instead of here.
-- --------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_projects_completed_aging
  ON projects (billed_at, end_date)
  WHERE project_progress_status = 'COMPLETED';

-- --------------------------------------------------------------------------
-- 3. Backfill
--
-- None, on purpose. The obvious move is to copy invoice_amount into billed_amount for
-- the 22 COMPLETED projects whose invoice status is PENDING ($252,194) — and it would
-- be wrong. PENDING does not distinguish "invoiced, waiting on the client" from "never
-- invoiced", and invoice_amount is an estimate anyway. Copying it would mint 22 invoices
-- that may not exist, at amounts nobody billed, and the aging report would then present
-- those inventions as fact with a confident number of days attached.
--
-- billed_amount fills in as the office records real invoices. Until a row is filled, the
-- report shows the project with a NULL balance and an age measured from end_date, which
-- is the honest answer: the work is done, the money is not in, and we do not yet know how
-- much was billed.
--
-- end_date is likewise not backfilled (it is set on only 1 of 110 projects). The
-- application now seals it when a project moves to COMPLETED, and it is never
-- overwritten, so a date entered by hand stays the date of record. Guessing historical
-- completion dates from created_at or lead start_date would antedate the aging buckets
-- for every project at once.
-- --------------------------------------------------------------------------
