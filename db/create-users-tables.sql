-- Users, roles and per-module permissions.
-- TypeORM runs with synchronize: false, so these statements must be applied manually
-- against Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- Permission codes are defined in src/common/auth/permissions.ts, not in a table:
-- a permission only exists if some route enforces it. role_permissions stores
-- those codes as plain strings.

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  -- Seeded roles: cannot be deleted from the admin UI.
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255),
  picture       VARCHAR(500),
  -- RESTRICT: a role with users assigned must not be deletable out from under them.
  role_id       INTEGER REFERENCES roles(id) ON DELETE RESTRICT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMP,
  notification_preferences JSONB NOT NULL DEFAULT '{"assignment":"email","status":"in_app","blocked":"in_app","comment":"in_app","mention":"in_app","digest":"email","digestHour":7}'::jsonb,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- Lookups always go through lower(email); the app normalizes before writing.
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role_id);

-- --------------------------------------------------------------------------
-- Seed the two system roles.
--
-- NOTE: 'admin' intentionally gets NO rows in role_permissions. The permission
-- resolver treats the admin system role as holding the entire catalog, so that
-- adding a new permission code in a later release can never leave admins
-- locked out of the feature it guards.
-- --------------------------------------------------------------------------

INSERT INTO roles (name, description, is_system)
VALUES
  ('admin',  'Full access, including finances and user administration', true),
  ('member', 'Day-to-day CRM access, including financial data. No user administration', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES
  ('dashboard:read'),
  ('finance:read'),
  ('leads:read'), ('leads:write'), ('leads:delete'),
  ('projects:read'), ('projects:write'), ('projects:delete'),
  ('contacts:read'), ('contacts:write'), ('contacts:delete'),
  ('companies:read'), ('companies:write'), ('companies:delete'),
  ('notes:read'), ('notes:write'), ('notes:delete'),
  ('reports:read')
) AS p(permission)
WHERE r.name = 'member'
ON CONFLICT (role_id, permission) DO NOTHING;
