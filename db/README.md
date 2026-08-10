# Database scripts

TypeORM schema synchronization is disabled. Apply each new SQL file manually through the
Supabase SQL editor, once per environment, before deploying code that reads its tables.

For note sharing, run `notes-sharing.sql`. It is idempotent and includes the visibility
backfill. Before production, take a backup and run the comparison query embedded in the
script to confirm that the backfill preserves the existing private-note rule.

For the tasks feature, run `create-tasks-tables.sql` then `create-notifications-table.sql`
— both depend on `users`/`roles` from `create-users-tables.sql`, which must already be
applied. `create-tasks-tables.sql` also grants the new `tasks:*` permissions to the
`member` role; `admin` needs nothing, since it resolves to the full permission catalog in
code (see `UsersService.effectivePermissions`). A role created later from the admin UI
needs `tasks:*` granted by hand there.
