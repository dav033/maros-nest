# Database scripts

TypeORM schema synchronization is disabled. Apply each new SQL file manually through the
Supabase SQL editor, once per environment, before deploying code that reads its tables.

For note sharing, run `notes-sharing.sql`. It is idempotent and includes the visibility
backfill. Before production, take a backup and run the comparison query embedded in the
script to confirm that the backfill preserves the existing private-note rule.
