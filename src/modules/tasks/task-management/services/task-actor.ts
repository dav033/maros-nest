import type { AuthenticatedUser } from '../../../../common/auth/authenticated-user';

/**
 * The caller, reduced to what TasksService needs.
 *
 * Deliberately smaller than notes' NoteActor: a task carries no per-row ownership or
 * visibility (see PLAN-TAREAS.md section 0.7) — `@RequirePermissions` on the route
 * already decides who may read or write, uniformly, for every task. `id` exists purely
 * to stamp who did what (reporter default, activity log, watchers).
 *
 * `canDelete` was added for comments: editing or removing someone else's comment needs
 * `tasks:delete`, not just `tasks:write` — see TaskCommentsService.
 */
export interface TaskActor {
  id: number;
  canDelete: boolean;
}

export function toTaskActor(user: AuthenticatedUser): TaskActor {
  return { id: user.id, canDelete: user.permissions.includes('tasks:delete') };
}
