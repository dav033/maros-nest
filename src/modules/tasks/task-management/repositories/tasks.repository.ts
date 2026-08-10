import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { Task, TaskStatus } from '../../../../entities/task.entity';
import type { SearchTasksDto } from '../dto/search-tasks.dto';

/** Relations every read needs: who's involved, the label set, and the parent (if a subtask). */
const TASK_RELATIONS = ['assignee', 'reporter', 'createdBy', 'labels', 'parent'];

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
   * AND with the rest. `includeSubtasks` off (the default) restricts to parent_id IS
   * NULL, which is what the board and list read.
   */
  async findAll(filters: SearchTasksDto): Promise<Task[]> {
    const qb = this.baseQuery().where('task.deleted_at IS NULL');

    if (!filters.includeSubtasks) {
      qb.andWhere('task.parent_id IS NULL');
    }
    if (filters.status) {
      qb.andWhere('task.status = :status', { status: filters.status });
    }
    if (filters.assigneeUserId !== undefined) {
      qb.andWhere('task.assignee_user_id = :assigneeUserId', {
        assigneeUserId: filters.assigneeUserId,
      });
    }
    if (filters.kind) {
      qb.andWhere('task.kind = :kind', { kind: filters.kind });
    }
    if (filters.priority) {
      qb.andWhere('task.priority = :priority', { priority: filters.priority });
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
    if (filters.labelId !== undefined) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM task_label_links l WHERE l.task_id = task.id AND l.label_id = :labelId)',
        { labelId: filters.labelId },
      );
    }
    if (filters.q) {
      qb.andWhere(`task.content_tsv @@ plainto_tsquery('simple', :q)`, { q: filters.q });
    }

    return qb
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
  }

  /** Top-level, active tasks for the board — grouped by status in TasksService. */
  async findForBoard(): Promise<Task[]> {
    return this.baseQuery()
      .where('task.deleted_at IS NULL')
      .andWhere('task.parent_id IS NULL')
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
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
