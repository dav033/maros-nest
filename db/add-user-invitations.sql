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
-- The token is never stored in clear: 32 random bytes (base64url) go out in the email
-- link and only their SHA-256 lives here, exactly as note_page_links does it. A leaked
-- backup hands nobody a working invitation.
--
-- Revocation is soft (revoked_at) so cancelling an invitation keeps the record of who
-- invited whom, and `email` is stored alongside user_id because it is the address the
-- message actually went to — changing users.email later must not rewrite history.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_invitations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  -- First characters of the token, so the UI can tell two invitations apart without
  -- being able to reconstruct either.
  token_hint    VARCHAR(8) NOT NULL,
  expires_at    TIMESTAMP NOT NULL,
  accepted_at   TIMESTAMP,
  revoked_at    TIMESTAMP,
  invited_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_token ON user_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations (user_id, created_at DESC);

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
