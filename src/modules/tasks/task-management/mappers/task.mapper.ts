import { Injectable } from '@nestjs/common';
import { Task, TASK_STATUSES } from '../../../../entities/task.entity';
import { TaskActivity } from '../../../../entities/task-activity.entity';
import { User } from '../../../../entities/user.entity';
import { resolveKey, type TaskEntityRef } from '../services/task-entity-resolver.service';
import type { TaskEntityKind } from '../dto/create-task.dto';
import type { TaskParty } from '../../../../entities/task-party.entity';

const BOARD_STATUSES = TASK_STATUSES.filter((status) => status !== 'cancelled');

export interface TaskCounts {
  subtasksTotal: number;
  subtasksDone: number;
  commentsCount: number;
}

@Injectable()
export class TaskMapper {
  static currentHourInBusinessTimezone(now = new Date()): number {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now));
  }

  /**
   * Postgres `date` columns come back as strings in practice — see lead.mapper.ts.
   * Public: TaskDigestCron reuses this to bucket a task against `todayInBusinessTimezone()`
   * without reimplementing the Date-vs-string normalization.
   */
  formatDate(date: Date | string | null | undefined): string | null {
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

  /** Looks up a task's resolved CRM link in the batch map — see TaskEntityResolverService. */
  private entityRefFor(entity: Task, entityRefsByKey?: Map<string, TaskEntityRef>): TaskEntityRef | null {
    if (!entityRefsByKey || !entity.entityKind || entity.entityId == null) return null;
    return entityRefsByKey.get(resolveKey(entity.entityKind as TaskEntityKind, entity.entityId)) ?? null;
  }

  /**
   * `counts` and `entityRefsByKey` are optional so `toSummaryDto` stays usable on its
   * own (defaults to zero counts / no resolved entity) — every current caller in
   * TasksService does look them up first, via buildCountsMap and
   * TaskEntityResolverService respectively.
   */
  toSummaryDto(entity: Task, counts?: TaskCounts, entityRefsByKey?: Map<string, TaskEntityRef>): any {
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
      entity: this.entityRefFor(entity, entityRefsByKey),
      startDate: this.formatDate(entity.startDate),
      dueDate: this.formatDate(entity.dueDate),
      blockedReason: entity.blockedReason ?? null,
      cancelledReason: entity.cancelledReason ?? null,
      completedAt: entity.completedAt ?? null,
      recurrenceRule: entity.recurrenceRule ?? null,
      recurrenceUntil: this.formatDate(entity.recurrenceUntil),
      estimatedHours: entity.estimatedHours ?? null,
      actualHours: entity.actualHours ?? 0,
      startedAt: entity.startedAt ?? null,
      labels: (entity.labels ?? []).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      subtasksTotal: counts?.subtasksTotal ?? 0,
      subtasksDone: counts?.subtasksDone ?? 0,
      commentsCount: counts?.commentsCount ?? 0,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Full task including description, subtasks and activity feed. `commentsCount` comes
   * from the caller (freshDetail already fetches the full comment list for the thread,
   * no separate count query needed) — `children` doubles as the subtask counts source.
   */
  toDetailDto(
    entity: Task,
    children: Task[],
    activity: TaskActivity[],
    commentsCount = 0,
    entityRefsByKey?: Map<string, TaskEntityRef>,
    parties: TaskParty[] = [],
    watcherIds: number[] = [],
  ): any {
    return {
      ...this.toSummaryDto(
        entity,
        {
          subtasksTotal: children.length,
          subtasksDone: children.filter((child) => child.status === 'done').length,
          commentsCount,
        },
        entityRefsByKey,
      ),
      description: entity.description ?? {},
      createdBy: entity.createdBy ? this.userRef(entity.createdBy) : null,
      attachments: entity.attachments ?? [],
      subtasks: children.map((child) => this.toSummaryDto(child, undefined, entityRefsByKey)),
      activity: activity.map((row) => this.toActivityDto(row)),
      parties: parties.map((party) => ({
        partyKind: party.partyKind,
        partyId: party.partyId,
        role: party.role,
      })),
      watcherIds,
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
  groupByStatus(
    tasks: Task[],
    countsByTaskId?: Map<number, TaskCounts>,
    entityRefsByKey?: Map<string, TaskEntityRef>,
  ): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    for (const status of BOARD_STATUSES) groups[status] = [];
    for (const task of tasks) {
      if (task.status === 'cancelled') continue;
      groups[task.status].push(this.toSummaryDto(task, countsByTaskId?.get(task.id), entityRefsByKey));
    }
    return groups;
  }

  /**
   * Buckets "Mine" by due date in America/New_York — the business's single timezone
   * (see PLAN-TAREAS.md decision #2). Comparison is done on plain YYYY-MM-DD strings:
   * ISO calendar dates sort lexicographically, so no Date parsing — and none of its
   * timezone pitfalls — is needed to bucket them.
   */
  bucketByDueDate(
    tasks: Task[],
    countsByTaskId?: Map<number, TaskCounts>,
    entityRefsByKey?: Map<string, TaskEntityRef>,
  ): Record<string, any[]> {
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
      const dto = this.toSummaryDto(task, countsByTaskId?.get(task.id), entityRefsByKey);
      const due = this.formatDate(task.dueDate);
      if (!due) buckets.noDueDate.push(dto);
      else if (due < today) buckets.overdue.push(dto);
      else if (due === today) buckets.today.push(dto);
      else if (due <= weekEnd) buckets.thisWeek.push(dto);
      else buckets.later.push(dto);
    }

    return buckets;
  }

  /** Public: also the "today" cutoff TaskDigestCron filters and buckets due dates against. */
  static todayInBusinessTimezone(): string {
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
