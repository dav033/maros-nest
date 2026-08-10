import { Injectable } from '@nestjs/common';
import { Task, TASK_STATUSES } from '../../../../entities/task.entity';
import { TaskActivity } from '../../../../entities/task-activity.entity';
import { User } from '../../../../entities/user.entity';

const BOARD_STATUSES = TASK_STATUSES.filter((status) => status !== 'cancelled');

@Injectable()
export class TaskMapper {
  /** Postgres `date` columns come back as strings in practice — see lead.mapper.ts. */
  private formatDate(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    if (typeof date === 'string') return date.split('T')[0];
    if (date instanceof Date) return date.toISOString().split('T')[0];
    return null;
  }

  private userRef(user: User): { id: number; name: string | null; email: string; picture: string | null } {
    return {
      id: user.id,
      name: user.name ?? null,
      email: user.email,
      picture: user.picture ?? null,
    };
  }

  toSummaryDto(entity: Task): any {
    return {
      id: entity.id,
      parentId: entity.parent?.id ?? null,
      title: entity.title,
      kind: entity.kind,
      status: entity.status,
      priority: entity.priority,
      position: entity.position,
      assignee: entity.assignee ? this.userRef(entity.assignee) : null,
      reporter: entity.reporter ? this.userRef(entity.reporter) : null,
      entityKind: entity.entityKind ?? null,
      entityId: entity.entityId ?? null,
      startDate: this.formatDate(entity.startDate),
      dueDate: this.formatDate(entity.dueDate),
      blockedReason: entity.blockedReason ?? null,
      completedAt: entity.completedAt ?? null,
      labels: (entity.labels ?? []).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /** Full task including description, subtasks and activity feed. */
  toDetailDto(entity: Task, children: Task[], activity: TaskActivity[]): any {
    return {
      ...this.toSummaryDto(entity),
      description: entity.description ?? {},
      createdBy: entity.createdBy ? this.userRef(entity.createdBy) : null,
      attachments: entity.attachments ?? [],
      subtasks: children.map((child) => this.toSummaryDto(child)),
      activity: activity.map((row) => this.toActivityDto(row)),
    };
  }

  private toActivityDto(row: TaskActivity): any {
    return {
      id: row.id,
      kind: row.kind,
      fromValue: row.fromValue ?? null,
      toValue: row.toValue ?? null,
      actor: row.actor ? this.userRef(row.actor) : null,
      createdAt: row.createdAt,
    };
  }

  /** Groups top-level tasks by status for the board. `cancelled` is left off — see TaskBoard. */
  groupByStatus(tasks: Task[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    for (const status of BOARD_STATUSES) groups[status] = [];
    for (const task of tasks) {
      if (task.status === 'cancelled') continue;
      groups[task.status].push(this.toSummaryDto(task));
    }
    return groups;
  }

  /**
   * Buckets "Mine" by due date in America/New_York — the business's single timezone
   * (see PLAN-TAREAS.md decision #2). Comparison is done on plain YYYY-MM-DD strings:
   * ISO calendar dates sort lexicographically, so no Date parsing — and none of its
   * timezone pitfalls — is needed to bucket them.
   */
  bucketByDueDate(tasks: Task[]): Record<string, any[]> {
    const today = TaskMapper.todayInBusinessTimezone();
    const weekEnd = TaskMapper.addDays(today, 7);

    const buckets: Record<string, any[]> = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDueDate: [],
    };

    for (const task of tasks) {
      const dto = this.toSummaryDto(task);
      const due = this.formatDate(task.dueDate);
      if (!due) buckets.noDueDate.push(dto);
      else if (due < today) buckets.overdue.push(dto);
      else if (due === today) buckets.today.push(dto);
      else if (due <= weekEnd) buckets.thisWeek.push(dto);
      else buckets.later.push(dto);
    }

    return buckets;
  }

  private static todayInBusinessTimezone(): string {
    // en-CA happens to format as YYYY-MM-DD, matching the DATE columns it's compared
    // against exactly — no Date object round-trip, no timezone-conversion pitfalls.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  }

  private static addDays(isoDate: string, days: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    // UTC on purpose: this is calendar-date arithmetic on a string, not a real instant,
    // so there is no local-timezone offset to get wrong.
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().split('T')[0];
  }
}
