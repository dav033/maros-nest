/**
 * Permission catalog.
 *
 * These codes are the single source of truth: a permission only exists if some
 * route enforces it via @RequirePermissions. They deliberately live in code
 * rather than in a table — a permission row the code never checks would be a
 * lie to whoever grants it in the admin UI.
 *
 * `role_permissions.permission` stores these strings. Removing a code here
 * without cleaning the table is harmless: unknown rows are ignored when the
 * guard resolves a user's effective permissions.
 */
export const PERMISSIONS = [
  'dashboard:read',

  // Money: revenue, backlog, costs, P&L, everything sourced from QuickBooks.
  // The one permission most likely to be withheld from a given role.
  'finance:read',

  'leads:read',
  'leads:write',
  'leads:delete',

  'projects:read',
  'projects:write',
  'projects:delete',

  'contacts:read',
  'contacts:write',
  'contacts:delete',

  'companies:read',
  'companies:write',
  'companies:delete',

  'notes:read',
  'notes:write',
  'notes:delete',

  'tasks:read',
  'tasks:write',
  'tasks:delete',

  'reports:read',

  // Administering users and roles.
  'users:read',
  'users:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Groups used to lay out the role editor in the admin UI. */
export const PERMISSION_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  permissions: readonly Permission[];
}> = [
  { key: 'dashboard', label: 'Dashboard', permissions: ['dashboard:read'] },
  { key: 'finance', label: 'Finance', permissions: ['finance:read'] },
  {
    key: 'leads',
    label: 'Leads',
    permissions: ['leads:read', 'leads:write', 'leads:delete'],
  },
  {
    key: 'projects',
    label: 'Projects',
    permissions: ['projects:read', 'projects:write', 'projects:delete'],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    permissions: ['contacts:read', 'contacts:write', 'contacts:delete'],
  },
  {
    key: 'companies',
    label: 'Companies',
    permissions: ['companies:read', 'companies:write', 'companies:delete'],
  },
  {
    key: 'notes',
    label: 'Notes',
    permissions: ['notes:read', 'notes:write', 'notes:delete'],
  },
  {
    key: 'tasks',
    label: 'Tasks',
    permissions: ['tasks:read', 'tasks:write', 'tasks:delete'],
  },
  { key: 'reports', label: 'Reports', permissions: ['reports:read'] },
  {
    key: 'users',
    label: 'Users & roles',
    permissions: ['users:read', 'users:write'],
  },
];

export const SYSTEM_ROLE_ADMIN = 'admin';
export const SYSTEM_ROLE_MEMBER = 'member';

/** Everything except finance and user administration. */
export const MEMBER_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) =>
    !permission.startsWith('finance:') && !permission.startsWith('users:'),
);
