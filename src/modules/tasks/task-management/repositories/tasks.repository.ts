import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { Task, TaskStatus } from '../../../../entities/task.entity';
import type { SearchTasksDto, TaskSortField } from '../dto/search-tasks.dto';
import type { ScheduleQueryDto } from '../dto/schedule-query.dto';
import { leadNumberSqlFilter } from '../../../../common/utils/lead-type.utils';

/** Relations every read needs: who's involved, the label set, and the parent (if a subtask). */
const TASK_RELATIONS = ['assignee', 'reporter', 'createdBy', 'labels', 'parent', 'workspace', 'folder', 'managedFiles'];

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
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

type TaskCursor = { id: number; value: string | number | null };

function encodeCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value?: string): TaskCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TaskCursor>;
    if (typeof parsed.id !== 'number' || (!['string', 'number'].includes(typeof parsed.value) && parsed.value !== null)) {
      return null;
    }
    return { id: parsed.id, value: parsed.value ?? null };
  } catch {
    return null;
  }
}

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
      .leftJoinAndSelect('task.parent', 'parent')
      .leftJoinAndSelect('task.workspace', 'workspace')
      .leftJoinAndSelect('task.folder', 'folder');
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
    if (filters.workspaceId !== undefined) {
      qb.andWhere('task.workspace_id = :workspaceId', { workspaceId: filters.workspaceId });
    }
    if (filters.folderId !== undefined) {
      if (filters.includeDescendants) {
        qb.andWhere(`(
          task.folder_id = :folderId OR task.folder_id IN (
            WITH RECURSIVE descendants AS (
              SELECT id FROM task_workspace_folders WHERE id = :folderId
              UNION ALL
              SELECT child.id FROM task_workspace_folders child
              JOIN descendants parent ON child.parent_folder_id = parent.id
            ) SELECT id FROM descendants
          )
        )`, { folderId: filters.folderId });
      } else {
        qb.andWhere('task.folder_id = :folderId', { folderId: filters.folderId });
      }
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
    if (filters.entityKind === 'lead' && filters.entityId !== undefined) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM leads job_lead
          LEFT JOIN projects job_project ON job_project.lead_id = job_lead.id
          WHERE job_lead.id = :jobId
            AND ((task.entity_kind = 'lead' AND task.entity_id = job_lead.id)
              OR (task.entity_kind = 'project' AND task.entity_id = job_project.id))
        )`,
        { jobId: filters.entityId },
      );
    } else {
      if (filters.entityKind) {
        qb.andWhere('task.entity_kind = :entityKind', { entityKind: filters.entityKind });
      }
      if (filters.entityId !== undefined) {
        qb.andWhere('task.entity_id = :entityId', { entityId: filters.entityId });
      }
    }
    if (filters.dueBefore) {
      qb.andWhere('task.due_date <= :dueBefore', { dueBefore: filters.dueBefore });
    }
    if (filters.dueOn) {
      qb.andWhere('task.due_date = :dueOn', { dueOn: filters.dueOn });
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
    if (filters.leadType) {
      const leadTypeFilter = leadNumberSqlFilter(
        filters.leadType,
        'job_lead.lead_number',
        'taskLeadNumberPattern',
      );
      qb.andWhere(
        `EXISTS (
           SELECT 1
           FROM leads job_lead
           LEFT JOIN projects job_project ON job_project.lead_id = job_lead.id
           WHERE ${leadTypeFilter?.clause ?? 'TRUE'}
             AND ((task.entity_kind = 'lead' AND task.entity_id = job_lead.id)
               OR (task.entity_kind = 'project' AND task.entity_id = job_project.id))
         )`,
        leadTypeFilter?.parameters,
      );
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
  async findAll(filters: SearchTasksDto): Promise<{ items: Task[]; totalCount: number; nextCursor: string | null }> {
    const sort = filters.sort ?? 'updatedAt';
    const direction = filters.direction ?? 'desc';
    const limit = Math.min(filters.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const cursor = decodeCursor(filters.cursor);
    const expression = this.sortExpression(sort);
    const idsQb = this.repo.createQueryBuilder('task').select('task.id', 'id');
    this.applySearchFilters(idsQb, filters);
    this.applyCursor(idsQb, filters, cursor);
    idsQb
      .orderBy(expression, direction.toUpperCase() as 'ASC' | 'DESC', sort === 'dueDate' ? 'NULLS LAST' : undefined)
      .addOrderBy('task.id', direction.toUpperCase() as 'ASC' | 'DESC')
      .limit(limit + 1);

    const countQb = this.repo.createQueryBuilder('task');
    this.applySearchFilters(countQb, filters);

    const [idRows, totalCount] = await Promise.all([
      idsQb.getRawMany<{ id: number }>(),
      countQb.getCount(),
    ]);

    const hasNextPage = idRows.length > limit;
    const pageRows = idRows.slice(0, limit);
    if (pageRows.length === 0) return { items: [], totalCount, nextCursor: null };

    const items = await this.baseQuery()
      .where('task.id IN (:...ids)', { ids: pageRows.map((row) => row.id) })
      .orderBy(expression, direction.toUpperCase() as 'ASC' | 'DESC', sort === 'dueDate' ? 'NULLS LAST' : undefined)
      .addOrderBy('task.id', direction.toUpperCase() as 'ASC' | 'DESC')
      .getMany();

    const last = items[items.length - 1];
    return {
      items,
      totalCount,
      nextCursor: hasNextPage && last ? encodeCursor({ id: last.id, value: this.cursorValue(last, sort) }) : null,
    };
  }

  async findByIdAny(id: number): Promise<Task | null> {
    return this.repo.findOne({ where: { id }, relations: TASK_RELATIONS });
  }

  async findArchived(): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NOT NULL')
      .orderBy('task.deleted_at', 'DESC')
      .addOrderBy('task.id', 'DESC')
      .getMany();
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
  async findForBoard(filters: SearchTasksDto = {}): Promise<Task[]> {
    const openIdsQb = this.repo.createQueryBuilder('task').select('task.id', 'id');
    this.applySearchFilters(openIdsQb, filters);
    openIdsQb
      .andWhere('task.status != :done', { done: 'done' })
      .andWhere('task.status != :cancelled', { cancelled: 'cancelled' })
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC');

    const doneIdsQb = this.repo.createQueryBuilder('task').select('task.id', 'id');
    this.applySearchFilters(doneIdsQb, filters);
    doneIdsQb
      .andWhere('task.status = :done', { done: 'done' })
      .andWhere(`task.completed_at >= now() - interval '${DONE_WINDOW_DAYS} days'`)
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .limit(DONE_LIMIT);

    const [openIds, doneIds] = await Promise.all([
      openIdsQb.getRawMany<{ id: number }>(),
      doneIdsQb.getRawMany<{ id: number }>(),
    ]);
    const ids = [...openIds, ...doneIds].map((row) => row.id);
    if (ids.length === 0) return [];

    return this.baseQuery()
      .where('task.id IN (:...ids)', { ids })
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
  }

  /** The true count behind `findForBoard`'s windowed `done` column. */
  async countDone(filters: SearchTasksDto = {}): Promise<number> {
    const qb = this.repo.createQueryBuilder('task');
    this.applySearchFilters(qb, filters);
    return qb
      .andWhere('task.status = :done', { done: 'done' })
      .getCount();
  }

  async restoreWithChildren(id: number): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({ deletedAt: null })
      .where('id = :id OR parent_id = :id', { id })
      .execute();
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
    return this.findSignalsForDigest(today, null);
  }

  /** Due work plus blocked work that has remained untouched long enough to escalate. */
  async findSignalsForDigest(today: string, blockedSince: string | null): Promise<Task[]> {
    const qb = this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.assignee_user_id IS NOT NULL')
      .andWhere('task.status NOT IN (:...closed)', { closed: ['done', 'cancelled'] })
      .andWhere(
        blockedSince
          ? '(task.due_date <= :today OR (task.status = \'blocked\' AND task.blocked_at <= :blockedSince))'
          : 'task.due_date <= :today',
        blockedSince ? { today, blockedSince } : { today },
      )
      .orderBy('task.assignee_user_id', 'ASC')
      .addOrderBy('task.due_date', 'ASC')
      .getMany();
    return qb;
  }

  /** Permit tasks get one reminder on the day three business-calendar days out. */
  async findPermitTasksDueOn(dueDate: string): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.kind = :kind', { kind: 'permit' })
      .andWhere('task.reporter_id IS NOT NULL')
      .andWhere('task.status NOT IN (:...closed)', { closed: ['done', 'cancelled'] })
      .andWhere('task.due_date = :dueDate', { dueDate })
      .getMany();
  }

  async findByEntity(entityKind: string, entityId: number): Promise<Task[]> {
    return this.findByEntityLinks([{ entityKind, entityId }]);
  }

  async findSchedule(filters: ScheduleQueryDto): Promise<Task[]> {
    const qb = this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.parent_id IS NULL')
      .andWhere('task.status NOT IN (:...closed)', { closed: ['cancelled'] });
    if (filters.from) {
      qb.andWhere('COALESCE(task.due_date, task.start_date) >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('COALESCE(task.start_date, task.due_date) <= :to', { to: filters.to });
    }
    if (filters.assigneeUserId?.length) {
      qb.andWhere('task.assignee_user_id IN (:...assigneeUserId)', { assigneeUserId: filters.assigneeUserId });
    }
    if (filters.jobId != null) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM leads schedule_job
          LEFT JOIN projects schedule_project ON schedule_project.lead_id = schedule_job.id
          WHERE schedule_job.id = :scheduleJobId
            AND ((task.entity_kind = 'lead' AND task.entity_id = schedule_job.id)
              OR (task.entity_kind = 'project' AND task.entity_id = schedule_project.id))
        )`,
        { scheduleJobId: filters.jobId },
      );
    }
    if (filters.leadType) {
      const leadTypeFilter = leadNumberSqlFilter(
        filters.leadType,
        'schedule_job.lead_number',
        'scheduleLeadNumberPattern',
      );
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM leads schedule_job
          LEFT JOIN projects schedule_project ON schedule_project.lead_id = schedule_job.id
          WHERE ${leadTypeFilter?.clause ?? 'TRUE'}
            AND ((task.entity_kind = 'lead' AND task.entity_id = schedule_job.id)
              OR (task.entity_kind = 'project' AND task.entity_id = schedule_project.id))
        )`,
        leadTypeFilter?.parameters,
      );
    }
    return qb.orderBy('task.start_date', 'ASC', 'NULLS LAST').addOrderBy('task.due_date', 'ASC', 'NULLS LAST').getMany();
  }

  private sortExpression(sort: TaskSortField): string {
    return {
      updatedAt: 'task.updated_at',
      createdAt: 'task.created_at',
      dueDate: 'task.due_date',
      priority: 'task.priority',
      title: 'task.title',
    }[sort];
  }

  private cursorValue(task: Task, sort: TaskSortField): string | number | null {
    if (sort === 'updatedAt') return task.updatedAt?.toISOString() ?? null;
    if (sort === 'createdAt') return task.createdAt?.toISOString() ?? null;
    if (sort === 'dueDate') return task.dueDate instanceof Date ? task.dueDate.toISOString() : task.dueDate ?? null;
    if (sort === 'priority') return task.priority;
    return task.title;
  }

  private applyCursor(
    qb: SelectQueryBuilder<Task>,
    filters: SearchTasksDto,
    cursor: TaskCursor | null,
  ): void {
    if (!cursor) return;
    const sort = filters.sort ?? 'updatedAt';
    const direction = filters.direction ?? 'desc';
    const expression = this.sortExpression(sort);
    const operator = direction === 'asc' ? '>' : '<';
    const tieOperator = direction === 'asc' ? '>' : '<';

    if (cursor.value === null) {
      qb.andWhere(`(${expression} IS NULL AND task.id ${tieOperator} :cursorId)`, {
        cursorId: cursor.id,
      });
      return;
    }

    const nullsLast = sort === 'dueDate' ? ` OR ${expression} IS NULL` : '';
    qb.andWhere(
      `((${expression} ${operator} :cursorValue${nullsLast}) OR (${expression} = :cursorValue AND task.id ${tieOperator} :cursorId))`,
      { cursorValue: cursor.value, cursorId: cursor.id },
    );
  }

  async findByIdsActive(ids: number[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.id IN (:...ids)', { ids })
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
  }

  async findByEntityLinks(links: Array<{ entityKind: string; entityId: number }>): Promise<Task[]> {
    if (links.length === 0) return [];
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere(
        new Brackets((where) => {
          links.forEach((link, index) => {
            const clause = `(task.entity_kind = :entityKind${index} AND task.entity_id = :entityId${index})`;
            const params = { [`entityKind${index}`]: link.entityKind, [`entityId${index}`]: link.entityId };
            if (index === 0) where.where(clause, params);
            else where.orWhere(clause, params);
          });
        }),
      )
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
   * The sibling set a subtask is ordered within — its parent's other children, rather
   * than a status column. Mirrors getSiblingsInColumn so both feed the same
   * computeInsertPosition/rebalanceSiblings pair.
   */
  async getSiblingsUnderParent(
    parentId: number,
    excludeId?: number,
  ): Promise<Array<{ id: number; position: number }>> {
    const qb = this.repo
      .createQueryBuilder('task')
      .select(['task.id AS id', 'task.position AS position'])
      .where('task.parent_id = :parentId', { parentId })
      .andWhere('task.deleted_at IS NULL');
    if (excludeId != null) {
      qb.andWhere('task.id != :excludeId', { excludeId });
    }
    qb.orderBy('task.position', 'ASC');
    return qb.getRawMany();
  }

  /**
   * A subtask's position is scoped to its parent, not to a status column — the board
   * never shows it (findForBoard filters parent_id IS NULL), so there is no column to
   * order it within. Used when appending; see getSiblingsUnderParent for reordering.
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
