-- Invited accounts: an admin creates the user, the system emails an invitation, and
-- that person signs in with their own Google account.
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- What this replaces: maros-next's google/callback route carried a hardcoded
-- EXTERNAL_EMAIL_ALLOWLIST, so letting one client in meant editing source and
-- redeploying. Applying this file moves that decision into `users`, where
-- POST /api/auth/invitations/check reads it on every external login.
--
-- Applying it changes NOTHING for anyone who already has an account: every existing
-- row defaults to the internal, active user it already was.

-- --------------------------------------------------------------------------
-- 1. Who a user is, and whether they may sign in
--
-- `status` is the lifecycle ('invited' until they first sign in), NOT the access
-- switch: `is_active` remains the one flag the session guard enforces. Keeping them
-- separate is deliberate — an invitation that has not been accepted yet is not the
-- same thing as an account somebody turned off.
--
-- The scope columns are persisted and exposed by the API but NOT yet enforced:
-- filtering projects/leads by scoped_company_id is a follow-up. Until then a client
-- role grants whatever the role says, company-wide — see section 3.
-- --------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type         TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS scoped_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scoped_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_id     INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- El DEFAULT solo aplica a filas nuevas: sin este backfill toda cuenta ya
-- desactivada aterrizaria en 'active' y la lista de admin mentiria sobre quien
-- puede entrar. Idempotente.
UPDATE users SET status = 'disabled' WHERE is_active = FALSE AND status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_user_type_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_user_type_check CHECK (user_type IN ('internal', 'client'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_status_check CHECK (status IN ('invited', 'active', 'disabled'));
  END IF;
END $$;

-- Postgres does not index a referencing column on its own, and deleting a company or
-- a contact has to check every one of these.
CREATE INDEX IF NOT EXISTS idx_users_scoped_company ON users (scoped_company_id);
CREATE INDEX IF NOT EXISTS idx_users_scoped_contact ON users (scoped_contact_id);

-- --------------------------------------------------------------------------
-- 2. The invitations themselves
--
-- There is no token. An invitation is not a credential: Google authenticates the person,
-- and this row only records that the address was expected. What it must hold instead is
-- the two facts that close the door — expires_at and revoked_at — which
-- POST /auth/invitations/check reads on every external login.
--
-- Revocation is soft (revoked_at) so cancelling an invitation keeps the record of who
-- invited whom, and `email` is stored alongside user_id because it is the address the
-- message actually went to — changing users.email later must not rewrite history.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_invitations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,
  expires_at    TIMESTAMP NOT NULL,
  accepted_at   TIMESTAMP,
  revoked_at    TIMESTAMP,
  invited_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- An earlier version of this file stored a SHA-256 of a 32-byte token that went out in
-- the invitation link. Nothing ever read it back — the link was never a login — so it
-- was a 256-bit secret travelling by email for nothing. Dropped rather than left
-- unused: token_hash is NOT NULL, so a database created before this would reject every
-- new invitation. Both statements are no-ops on a database that never had the columns.
DROP INDEX IF EXISTS uq_user_invitations_token;
ALTER TABLE user_invitations
  DROP COLUMN IF EXISTS token_hash,
  DROP COLUMN IF EXISTS token_hint;

CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations (user_id, created_at DESC);

-- The admission check knows the Google address and nothing else, so this is the lookup
-- every external login makes.
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations (email, created_at DESC);

-- One live invitation per user. Resending revokes the previous one before writing the
-- new one; this index is what guarantees it rather than trusting the service to.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_pending
  ON user_invitations (user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- --------------------------------------------------------------------------
-- 3. Roles
--
-- 'client' is seeded with NO rows in role_permissions, and that is deliberate rather
-- than an oversight: every code in the catalogue is company-wide until row-level
-- scoping lands, so 'projects:read' would show an invited client every project Maros
-- has. The role exists so accounts can be created and scoped now; grant it permissions
-- from the role editor once scoping enforces scoped_company_id.
--
-- 'Solo task' is what AUTH_DEFAULT_ROLE points at — every self-provisioned Google
-- login lands on it — but no versioned SQL ever created it, so on a fresh database
-- UsersService.provision() logged a warning and left the user with no role at all.
--
-- Both are is_system: their names are referenced from code/config, so they must not be
-- renamed away. Their permission sets stay editable (only 'admin' resolves in code).
-- --------------------------------------------------------------------------

INSERT INTO roles (name, description, is_system)
VALUES
  ('client',    'Invited external client. Starts with no permissions until data scoping is enforced', true),
  ('Solo task', 'Default role for a new internal login: tasks only, no CRM or finance', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES
  ('tasks:read'), ('tasks:write')
) AS p(permission)
WHERE r.name = 'Solo task'
ON CONFLICT (role_id, permission) DO NOTHING;
