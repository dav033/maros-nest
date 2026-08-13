-- Board scale fix: the `done` column no longer loads every task ever completed (see
-- TasksRepository.findForBoard), just a recent window ordered by position. This index
-- matches that access pattern. TypeORM runs with synchronize: false, so apply manually
-- against Supabase (SQL editor or psql). Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_tasks_done_recent
  ON tasks (completed_at DESC)
  WHERE status = 'done' AND parent_id IS NULL AND deleted_at IS NULL;
