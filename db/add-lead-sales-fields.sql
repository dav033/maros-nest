-- Lead sales fields: the columns that make the funnel answerable.
--
-- TypeORM runs with synchronize: false, so these statements are applied by hand against
-- Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- What forced this. A production audit found 209 leads: 77 won, 59 lost, 62 still
-- undecided (27 of them with a NULL status, the oldest untouched for 17 months), and the
-- three largest losses adding up to roughly the entire won value. Not one of those
-- numbers could be acted on, because a lead recorded who it belonged to nowhere, why it
-- was lost nowhere, where it came from nowhere, when it was next due nowhere, and kept no
-- trace of how it got to its current status. Five columns and one table below.

-- --------------------------------------------------------------------------
-- 1. leads
-- --------------------------------------------------------------------------

-- ON DELETE SET NULL, not CASCADE: a salesperson leaving the company must not take their
-- deals with them. The lead becomes unassigned and shows up in the unowned bucket, which
-- is the signal somebody has to pick it up.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- VARCHAR, not an enum type and not a CHECK constraint. The allowed values live in code
-- (LEAD_SOURCES / LEAD_LOST_REASONS in the leads module) because sales will discover
-- missing buckets by using this — "the channel we forgot" is the normal outcome of the
-- first quarter of reporting. A CHECK would turn adding one into a manual production
-- migration, and the pressure to skip that is how free-text reason fields get born.
-- Width is 40 so the longest plausible snake_case label still fits with room to spare.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(40);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(40);

-- DATE, not TIMESTAMP: "call them back on the 14th" is a day, and giving it a time would
-- invite timezone arithmetic into a field whose only query is "what is due by today".
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up_at DATE;

-- Left NULL on every existing row, deliberately. Nothing in `leads` records when a status
-- was last touched — there is no updated_at, and start_date is the job's planned start,
-- not a pipeline event — so any backfill would be a number invented and then reported on.
-- NULL has to be read as "unknown, predates this column", never as "sitting in this stage
-- since forever": time-in-stage reports must exclude these rows rather than skew on them.
-- Rows get a real value the first time their status moves through the API.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP;

-- "What is on my plate" is the one lead query that runs per user on every page load.
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads (owner_id);

-- Partial: the follow-up queue asks for rows that have a date and are due. Most leads
-- never get one, and indexing those NULLs would only make the index bigger than the
-- answer it serves.
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up
  ON leads (next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

-- No index on source or lost_reason on purpose: both are read as "group the whole table
-- by this", at a few hundred rows, so the planner would sequentially scan regardless.
-- Revisit if leads ever reaches six figures.

-- --------------------------------------------------------------------------
-- 2. lead_status_events
--
-- leads.status only ever says where a lead is right now, which is why "how long does a
-- proposal sit before it closes" and "which stage do deals die in" had no answer at all.
-- Append-only history: correcting a status writes another row, nothing is ever rewritten.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_status_events (
  id            SERIAL PRIMARY KEY,
  -- CASCADE: the history of a lead nobody can open is unreadable noise, and deleting a
  -- lead is already an explicit, permission-gated action in LeadsService.deleteLead.
  lead_id       INTEGER     NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- Nullable because the first recorded move of the 27 NULL-status leads genuinely has no
  -- origin stage. VARCHAR rather than the lead_status enum both columns describe: history
  -- has to survive the enum being edited, and retiring a stage must not invalidate the
  -- rows that passed through it back when it existed.
  from_status   VARCHAR(40),
  -- NOT NULL: "moved to nowhere" measures nothing. A patch that clears a lead's status
  -- (possible, since leads.status is nullable) deliberately records no event.
  to_status     VARCHAR(40) NOT NULL,
  -- SET NULL, and nullable from the start: MCP tools and background jobs change statuses
  -- with no signed-in user behind them, so an unattributed event is normal, not a defect.
  changed_by_id INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  changed_at    TIMESTAMP   NOT NULL DEFAULT now()
);

-- changed_at rides along in the index because every read of this table is one lead's moves
-- in order — consecutive rows are subtracted to get time-in-stage, so the sort is the query.
CREATE INDEX IF NOT EXISTS idx_lead_status_events_lead
  ON lead_status_events (lead_id, changed_at);

-- --------------------------------------------------------------------------
-- 3. Backfill
--
-- None. There is no stored evidence of any past status change — no audit table, no
-- timestamps on leads — so the only honest starting point is an empty history. The first
-- usable cohort is the leads that move after this migration is applied; the 209 rows that
-- already exist contribute their current status and nothing about how they reached it.
-- --------------------------------------------------------------------------
