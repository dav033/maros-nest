-- Restrict a user to the leads and projects of certain lead types.
--
-- TypeORM runs with synchronize: false, so these statements are applied by hand against
-- Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- WHY. Every user who can read leads reads all of them. Somebody who only works plumbing
-- sees the construction pipeline, its clients and its money, and there is no way to narrow
-- that down short of taking the permission away entirely.
--
-- NULL means no restriction — the user sees every type. That is the default and what all
-- 6 existing rows get, so applying this changes nothing until somebody sets a scope.
--
-- An EMPTY array is rejected rather than stored. It would read as "restricted to no
-- types", which is a user who can open the leads screen and is told there are none —
-- indistinguishable from a bug. Taking the permission away is how you say "no leads".

ALTER TABLE users ADD COLUMN IF NOT EXISTS scoped_lead_types TEXT[];

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_scoped_lead_types_not_empty;
ALTER TABLE users ADD CONSTRAINT users_scoped_lead_types_not_empty
  CHECK (scoped_lead_types IS NULL OR cardinality(scoped_lead_types) > 0);

-- The values are the LeadType enum. A CHECK and not a foreign key because the enum lives
-- in the code (src/common/enums/lead-type.enum.ts), and a typo here is a user who silently
-- matches nothing — the worst failure for a filter, because it looks like "no leads" and
-- not like a mistake.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_scoped_lead_types_valid;
ALTER TABLE users ADD CONSTRAINT users_scoped_lead_types_valid
  CHECK (
    scoped_lead_types IS NULL
    OR scoped_lead_types <@ ARRAY['CONSTRUCTION', 'PLUMBING', 'ROOFING']::TEXT[]
  );

COMMENT ON COLUMN users.scoped_lead_types IS
  'Lead types this user may see. NULL means every type (the default). Enforced on the lead and project read paths, not only stored — see request-scope.ts and applyLeadTypeScope.';

-- Deliberately no index. The column is read once per request from the resolved-user cache,
-- never used to search users, and the table holds 11 rows.

-- --------------------------------------------------------------------------
-- Backfill
--
-- None. Every row stays NULL, which is "sees everything" — the behaviour before this
-- column existed. Guessing a scope from, say, the lead types somebody has touched would
-- silently lock people out of work they were doing yesterday.
-- --------------------------------------------------------------------------
