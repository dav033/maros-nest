import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { Task, TaskStatus } from '../../../../entities/task.entity';
import type { SearchTasksDto } from '../dto/search-tasks.dto';

/** Relations every read needs: who's involved, the label set, and the parent (if a subtask). */
const TASK_RELATIONS = ['assignee', 'reporter', 'createdBy', 'labels', 'parent'];

/**
 * The board's `done` column window — see findForBoard. Open work (backlog/todo/
 * in_progress/blocked) is always shown in full; `done` accumulates forever otherwise,
 * so it's capped to what's recent. `countDone` reports the true total for the "view
 * all completed" link the frontend renders when the count exceeds this cap.
 */
const DONE_WINDOW_DAYS = 30;
const DONE_LIMIT = 50;

/**
 * Hard cap on GET /tasks — an unfiltered instance can otherwise download every
 * top-level task the company has ever created in one response. `findAll` reports the
 * true count alongside it, so the frontend can tell the difference between "that's
 * everything" and "narrow with a filter to see the rest" (see SearchTasksDto's
 * status/kind/priority/assigneeUserId/labelId, which already cut this down in the
 * common case).
 */
const LIST_LIMIT = 500;

@Injectable()
export class TasksRepository {
  constructor(
    @InjectRepository(Task)
    private readonly repo: Repository<Task>,
  ) {}

  private baseQuery(): SelectQueryBuilder<Task> {
    return this.repo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.reporter', 'reporter')
      .leftJoinAndSelect('task.createdBy', 'createdBy')
      .leftJoinAndSelect('task.labels', 'labels')
      .leftJoinAndSelect('task.parent', 'parent');
  }

  async findByIdActive(id: number): Promise<Task | null> {
    return this.repo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: TASK_RELATIONS,
    });
  }

  /**
   * The full filter surface behind GET /tasks — see SearchTasksDto. Every field is an
   * AND with the rest; a field carrying several values (status, assigneeUserId, kind,
   * priority, labelId) OR's those together first — SearchTasksDto normalizes every one
   * of them to an array regardless of whether the caller sent one value or several, so
   * this never has to branch on that. `includeSubtasks` off (the default) restricts to
   * parent_id IS NULL, which is what the board and list read. Shared between findAll
   * and its count so the two can never silently drift apart.
   */
  private applySearchFilters(qb: SelectQueryBuilder<Task>, filters: SearchTasksDto): void {
    qb.where('task.deleted_at IS NULL');

    if (!filters.includeSubtasks) {
      qb.andWhere('task.parent_id IS NULL');
    }
    if (filters.status?.length) {
      qb.andWhere('task.status IN (:...status)', { status: filters.status });
    }
    if (filters.assigneeUserId?.length) {
      qb.andWhere('task.assignee_user_id IN (:...assigneeUserId)', {
        assigneeUserId: filters.assigneeUserId,
      });
    }
    if (filters.kind?.length) {
      qb.andWhere('task.kind IN (:...kind)', { kind: filters.kind });
    }
    if (filters.priority?.length) {
      qb.andWhere('task.priority IN (:...priority)', { priority: filters.priority });
    }
    if (filters.entityKind) {
      qb.andWhere('task.entity_kind = :entityKind', { entityKind: filters.entityKind });
    }
    if (filters.entityId !== undefined) {
      qb.andWhere('task.entity_id = :entityId', { entityId: filters.entityId });
    }
    if (filters.dueBefore) {
      qb.andWhere('task.due_date <= :dueBefore', { dueBefore: filters.dueBefore });
    }
    if (filters.labelId?.length) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM task_label_links l WHERE l.task_id = task.id AND l.label_id IN (:...labelId))',
        { labelId: filters.labelId },
      );
    }
    if (filters.q) {
      qb.andWhere(`task.content_tsv @@ plainto_tsquery('simple', :q)`, { q: filters.q });
    }
  }

  /**
   * Capped at LIST_LIMIT — see its doc comment. `totalCount` is the true count behind
   * that cap, computed with the same filters via applySearchFilters, so the two can
   * never disagree about what "matches" means.
   *
   * Same id-first, hydrate-second shape as findForBoard, and for the same reason: a
   * LIMIT applied directly to `baseQuery()`'s left-joined (`labels`) query caps raw SQL
   * rows, not distinct tasks.
   */
  async findAll(filters: SearchTasksDto): Promise<{ items: Task[]; totalCount: number }> {
    const idsQb = this.repo.createQueryBuilder('task').select('task.id', 'id');
    this.applySearchFilters(idsQb, filters);
    idsQb
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .limit(LIST_LIMIT);

    const countQb = this.repo.createQueryBuilder('task');
    this.applySearchFilters(countQb, filters);

    const [idRows, totalCount] = await Promise.all([
      idsQb.getRawMany<{ id: number }>(),
      countQb.getCount(),
    ]);

    if (idRows.length === 0) return { items: [], totalCount };

    const items = await this.baseQuery()
      .where('task.id IN (:...ids)', { ids: idRows.map((row) => row.id) })
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();

    return { items, totalCount };
  }

  /**
   * Top-level, active tasks for the board — grouped by status in TasksService.
   * Open statuses come back in full; `done` is windowed to the last
   * DONE_WINDOW_DAYS, capped at DONE_LIMIT — see countDone for the true total.
   *
   * The cap is applied to a plain id query, not the joined `baseQuery()`: a LIMIT on
   * a query left-joined to a many-to-many (`labels`) applies to raw SQL rows, not
   * distinct tasks, so limiting the joined query directly can silently return fewer
   * tasks than intended (or one with a truncated label set). Fetching ids first and
   * then the full rows `WHERE id IN (...)` sidesteps that entirely.
   */
  async findForBoard(): Promise<Task[]> {
    const [open, doneIds] = await Promise.all([
      this.baseQuery()
        .where('task.deleted_at IS NULL')
        .andWhere('task.parent_id IS NULL')
        .andWhere('task.status != :done', { done: 'done' })
        .orderBy('task.status', 'ASC')
        .addOrderBy('task.position', 'ASC')
        .addOrderBy('task.id', 'ASC')
        .getMany(),
      this.repo
        .createQueryBuilder('task')
        .select('task.id', 'id')
        .where('task.deleted_at IS NULL')
        .andWhere('task.parent_id IS NULL')
        .andWhere('task.status = :done', { done: 'done' })
        .andWhere(`task.completed_at >= now() - interval '${DONE_WINDOW_DAYS} days'`)
        .orderBy('task.position', 'ASC')
        .limit(DONE_LIMIT)
        .getRawMany<{ id: number }>(),
    ]);

    if (doneIds.length === 0) return open;

    const done = await this.baseQuery()
      .where('task.id IN (:...ids)', { ids: doneIds.map((row) => row.id) })
      .orderBy('task.position', 'ASC')
      .getMany();

    return [...open, ...done];
  }

  /** The true count behind `findForBoard`'s windowed `done` column. */
  async countDone(): Promise<number> {
    return this.repo
      .createQueryBuilder('task')
      .where('task.deleted_at IS NULL')
      .andWhere('task.parent_id IS NULL')
      .andWhere('task.status = :done', { done: 'done' })
      .getCount();
  }

  /**
   * A user's open work, for "Mine". `done`/`cancelled` are left out — this view is
   * about what still needs attention, not a history of everything ever assigned.
   */
  async findMine(userId: number): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.assignee_user_id = :userId', { userId })
      .andWhere('task.status NOT IN (:...closed)', { closed: ['done', 'cancelled'] })
      .orderBy('task.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy('task.priority', 'ASC')
      .getMany();
  }

  /**
   * Assigned, still-open tasks due on or before `today` — the raw material for the
   * daily digest. TaskDigestCron does the per-assignee grouping and overdue/due-today
   * split; this only filters.
   */
  async findDueForDigest(today: string): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.assignee_user_id IS NOT NULL')
      .andWhere('task.status NOT IN (:...closed)', { closed: ['done', 'cancelled'] })
      .andWhere('task.due_date <= :today', { today })
      .orderBy('task.assignee_user_id', 'ASC')
      .addOrderBy('task.due_date', 'ASC')
      .getMany();
  }

  async findByEntity(entityKind: string, entityId: number): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.entity_kind = :entityKind', { entityKind })
      .andWhere('task.entity_id = :entityId', { entityId })
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
  }

  /** Active direct subtasks of a task — one level, so no recursion needed. */
  async findChildren(parentId: number): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.parent_id = :parentId', { parentId })
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
  }

  /** Children not already done/cancelled — what "closing a task with work still open" warns about. */
  async countOpenChildren(parentId: number): Promise<number> {
    return this.repo
      .createQueryBuilder('task')
      .where('task.parent_id = :parentId', { parentId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere('task.status NOT IN (:...closed)', { closed: ['done', 'cancelled'] })
      .getCount();
  }

  /**
   * Bulk subtask total/done counts, one row per parent — the board/list/mine rows'
   * "2/4 subtasks" footer. A single grouped query for however many parents are on
   * screen, not N+1 per card.
   */
  async countSubtasksByParents(parentIds: number[]): Promise<Map<number, { total: number; done: number }>> {
    const map = new Map<number, { total: number; done: number }>();
    if (parentIds.length === 0) return map;
    const rows: Array<{ parent_id: number; total: string; done: string }> = await this.repo.manager.query(
      `SELECT parent_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'done') AS done
       FROM tasks
       WHERE parent_id = ANY($1) AND deleted_at IS NULL
       GROUP BY parent_id`,
      [parentIds],
    );
    for (const row of rows) {
      map.set(Number(row.parent_id), { total: Number(row.total), done: Number(row.done) });
    }
    return map;
  }

  /** Bulk comment counts, one row per task — same shape and reasoning as countSubtasksByParents. */
  async countCommentsByTasks(taskIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (taskIds.length === 0) return map;
    const rows: Array<{ task_id: number; count: string }> = await this.repo.manager.query(
      `SELECT task_id, COUNT(*) AS count
       FROM task_comments
       WHERE task_id = ANY($1) AND deleted_at IS NULL
       GROUP BY task_id`,
      [taskIds],
    );
    for (const row of rows) map.set(Number(row.task_id), Number(row.count));
    return map;
  }

  async save(task: Task): Promise<Task> {
    return this.repo.save(task);
  }

  async getMaxPositionInColumn(status: TaskStatus): Promise<number> {
    const result: { max: number | null } | undefined = await this.repo
      .createQueryBuilder('task')
      .select('MAX(task.position)', 'max')
      .where('task.status = :status', { status })
      .andWhere('task.parent_id IS NULL')
      .andWhere('task.deleted_at IS NULL')
      .getRawOne();
    return result?.max ?? 0;
  }

  /** Ordered active top-level siblings in a status column, for computing a move position. */
  async getSiblingsInColumn(
    status: TaskStatus,
    excludeId?: number,
  ): Promise<Array<{ id: number; position: number }>> {
    const qb = this.repo
      .createQueryBuilder('task')
      .select(['task.id AS id', 'task.position AS position'])
      .where('task.status = :status', { status })
      .andWhere('task.parent_id IS NULL')
      .andWhere('task.deleted_at IS NULL');
    if (excludeId != null) {
      qb.andWhere('task.id != :excludeId', { excludeId });
    }
    qb.orderBy('task.position', 'ASC');
    return qb.getRawMany();
  }

  /** Reassigns positions to clean multiples of the step, preserving the given order. */
  async rebalanceSiblings(orderedIds: number[], step: number): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) => this.repo.update(id, { position: (index + 1) * step })),
    );
  }

  /**
   * A subtask's position is scoped to its parent, not to a status column — the board
   * never shows it (findForBoard filters parent_id IS NULL), so there is no column to
   * order it within. No reordering endpoint exists yet, so this only ever appends.
   */
  async getMaxPositionUnderParent(parentId: number): Promise<number> {
    const result: { max: number | null } | undefined = await this.repo
      .createQueryBuilder('task')
      .select('MAX(task.position)', 'max')
      .where('task.parent_id = :parentId', { parentId })
      .andWhere('task.deleted_at IS NULL')
      .getRawOne();
    return result?.max ?? 0;
  }

  /**
   * Soft-deletes a task and its direct subtasks (one level — no recursion needed, see
   * PLAN-TAREAS.md section 0.5).
   */
  async softDeleteWithChildren(id: number): Promise<void> {
    await this.repo.manager.query(
      `UPDATE tasks SET deleted_at = now()
       WHERE deleted_at IS NULL AND (id = $1 OR parent_id = $1)`,
      [id],
    );
  }
}
