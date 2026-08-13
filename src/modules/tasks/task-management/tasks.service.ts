import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TasksRepository } from './repositories/tasks.repository';
import { TaskLabelsRepository } from './repositories/task-labels.repository';
import { TaskWatchersRepository } from './repositories/task-watchers.repository';
import { TaskActivityService } from './services/task-activity.service';
import { TaskCommentsService } from './services/task-comments.service';
import { TaskMapper, TaskCounts } from './mappers/task.mapper';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { SetAssigneeDto } from './dto/set-assignee.dto';
import { SetLabelsDto } from './dto/set-labels.dto';
import { SetEntityDto } from './dto/set-entity.dto';
import { SearchTasksDto } from './dto/search-tasks.dto';
import { Task, TaskStatus } from '../../../entities/task.entity';
import type { TaskActor } from './services/task-actor';
import { computeInsertPosition } from './services/task-position.util';
import {
  TaskNotFoundException,
  TaskConflictException,
  TaskSubtaskNestingException,
  TaskBlockedReasonRequiredException,
} from '../../../common/exceptions';
import { extractPlainTextFromTipTapDoc } from '../../../common/utils/tiptap-text.util';

const POSITION_STEP = 1000;

@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly taskLabelsRepository: TaskLabelsRepository,
    private readonly taskWatchersRepository: TaskWatchersRepository,
    private readonly taskActivity: TaskActivityService,
    private readonly taskComments: TaskCommentsService,
    private readonly taskMapper: TaskMapper,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async freshDetail(id: number): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);
    const [children, activity, comments] = await Promise.all([
      this.tasksRepository.findChildren(id),
      this.taskActivity.findByTask(id),
      this.taskComments.list(id),
    ]);
    return { ...this.taskMapper.toDetailDto(task, children, activity, comments.length), comments };
  }

  /**
   * One grouped query per count kind for however many `tasks` are on screen, instead of
   * per-card N+1s — see TasksRepository.countSubtasksByParents/countCommentsByTasks.
   */
  private async buildCountsMap(tasks: Task[]): Promise<Map<number, TaskCounts>> {
    const ids = tasks.map((t) => t.id);
    const [subtaskCounts, commentCounts] = await Promise.all([
      this.tasksRepository.countSubtasksByParents(ids),
      this.tasksRepository.countCommentsByTasks(ids),
    ]);
    const map = new Map<number, TaskCounts>();
    for (const task of tasks) {
      const subtasks = subtaskCounts.get(task.id);
      map.set(task.id, {
        subtasksTotal: subtasks?.total ?? 0,
        subtasksDone: subtasks?.done ?? 0,
        commentsCount: commentCounts.get(task.id) ?? 0,
      });
    }
    return map;
  }

  async getBoard(): Promise<Record<string, any[]>> {
    const tasks = await this.tasksRepository.findForBoard();
    const counts = await this.buildCountsMap(tasks);
    return this.taskMapper.groupByStatus(tasks, counts);
  }

  async getMine(actor: TaskActor): Promise<Record<string, any[]>> {
    const tasks = await this.tasksRepository.findMine(actor.id);
    const counts = await this.buildCountsMap(tasks);
    return this.taskMapper.bucketByDueDate(tasks, counts);
  }

  async findAll(filters: SearchTasksDto): Promise<any[]> {
    const tasks = await this.tasksRepository.findAll(filters);
    const counts = await this.buildCountsMap(tasks);
    return tasks.map((task) => this.taskMapper.toSummaryDto(task, counts.get(task.id)));
  }

  async getByEntity(entityKind: string, entityId: number): Promise<any[]> {
    const tasks = await this.tasksRepository.findByEntity(entityKind, entityId);
    const counts = await this.buildCountsMap(tasks);
    return tasks.map((task) => this.taskMapper.toSummaryDto(task, counts.get(task.id)));
  }

  async getById(id: number): Promise<any> {
    return this.freshDetail(id);
  }

  async create(dto: CreateTaskDto, actor: TaskActor): Promise<any> {
    const task = new Task();
    task.title = dto.title?.trim() || 'Untitled task';
    task.description = dto.description ?? {};
    task.descriptionText = dto.description
      ? extractPlainTextFromTipTapDoc(dto.description)
      : undefined;
    task.kind = dto.kind ?? 'general';
    task.priority = dto.priority ?? 'normal';
    task.status = 'todo';
    task.assigneeUserId = dto.assigneeUserId ?? null;
    task.reporterId = dto.reporterId ?? actor.id;
    task.entityKind = dto.entityKind ?? null;
    task.entityId = dto.entityId ?? null;
    task.startDate = dto.startDate ? new Date(dto.startDate) : null;
    task.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    task.createdById = actor.id;

    if (dto.parentId != null) {
      const parent = await this.tasksRepository.findByIdActive(dto.parentId);
      if (!parent) throw new TaskNotFoundException(dto.parentId);
      // One level only — a subtask of a subtask is rejected here, not left to the
      // reader to notice a three-deep chain. See PLAN-TAREAS.md section 0.5.
      if (parent.parent != null) throw new TaskSubtaskNestingException(dto.parentId);
      task.parent = parent;
    } else {
      task.parent = null;
    }

    task.position = task.parent
      ? (await this.tasksRepository.getMaxPositionUnderParent(task.parent.id)) + POSITION_STEP
      : (await this.tasksRepository.getMaxPositionInColumn(task.status)) + POSITION_STEP;

    const saved = await this.tasksRepository.save(task);

    await this.taskActivity.logCreated(saved.id, actor.id);
    if (saved.parent) {
      await this.taskActivity.logSubtaskAdded(saved.parent.id, actor.id, saved.id);
    }

    // Reporter and assignee watch by default; duplicates (same person, or nulls) are a
    // no-op — see TaskWatchersRepository.addMany.
    await this.taskWatchersRepository.addMany(saved.id, [
      actor.id,
      task.reporterId,
      task.assigneeUserId,
    ]);

    if (saved.assigneeUserId != null) {
      this.eventEmitter.emit('task.assigned', {
        taskId: saved.id,
        assigneeUserId: saved.assigneeUserId,
        actorId: actor.id,
      });
    }

    return this.freshDetail(saved.id);
  }

  async update(id: number, dto: UpdateTaskDto, actor: TaskActor): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    // Only checked when the caller sent it — see UpdateTaskDto. A stale edit is
    // rejected before any field is touched, so a conflicting request never partially
    // applies.
    if (
      dto.expectedUpdatedAt !== undefined &&
      new Date(dto.expectedUpdatedAt).getTime() !== task.updatedAt.getTime()
    ) {
      throw new TaskConflictException();
    }

    if (dto.title !== undefined) task.title = dto.title.trim() || 'Untitled task';

    if (dto.description !== undefined) {
      task.description = dto.description;
      task.descriptionText = extractPlainTextFromTipTapDoc(dto.description);
    }

    if (dto.kind !== undefined) task.kind = dto.kind;

    if (dto.priority !== undefined && dto.priority !== task.priority) {
      await this.taskActivity.logPriorityChanged(id, actor.id, task.priority, dto.priority);
      task.priority = dto.priority;
    }

    if (dto.reporterId !== undefined) task.reporterId = dto.reporterId;

    if (dto.startDate !== undefined) {
      task.startDate = dto.startDate ? new Date(dto.startDate) : null;
    }

    if (dto.dueDate !== undefined) {
      const from = task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : null;
      const to = dto.dueDate ?? null;
      if (from !== to) {
        await this.taskActivity.logDueChanged(id, actor.id, from, to);
      }
      task.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    if (dto.blockedReason !== undefined) {
      // Clearing the reason while still blocked would violate tasks_blocked_needs_reason
      // at the DB — caught here for a clean 422 instead of a raw constraint error.
      if (dto.blockedReason == null && task.status === 'blocked') {
        throw new TaskBlockedReasonRequiredException();
      }
      task.blockedReason = dto.blockedReason;
    }

    await this.tasksRepository.save(task);
    return this.freshDetail(id);
  }

  /**
   * Attachments never go through `update()` — see PATCH's UpdateTaskDto, which no
   * longer carries the field. Two browsers uploading to the same task at once each
   * hold their own (possibly stale) copy of the list; a "send the whole array back"
   * PATCH would let the second save silently erase the first upload. These three
   * methods instead re-read the row and apply one operation to the server's current
   * set, so the only way to lose an attachment is to remove it on purpose.
   */
  async addAttachments(id: number, keys: string[], actor: TaskActor): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    const existing = new Set(task.attachments);
    const added = keys.filter((key) => !existing.has(key));
    if (added.length === 0) return this.freshDetail(id);

    task.attachments = [...task.attachments, ...added];
    await this.tasksRepository.save(task);
    await this.taskActivity.logAttachmentAdded(id, actor.id, added.length);
    return this.freshDetail(id);
  }

  async removeAttachment(id: number, key: string): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    task.attachments = task.attachments.filter((existingKey) => existingKey !== key);
    await this.tasksRepository.save(task);
    return this.freshDetail(id);
  }

  /**
   * Reconciled against the server's current set, not applied verbatim: a stale
   * reorder (issued before a concurrent add/remove landed) must not resurrect a
   * just-removed key or silently drop a just-added one. Keys the caller doesn't know
   * about yet are appended at the end.
   */
  async reorderAttachments(id: number, orderedKeys: string[]): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    const current = new Set(task.attachments);
    const reordered = orderedKeys.filter((key) => current.has(key));
    const missing = task.attachments.filter((key) => !reordered.includes(key));
    task.attachments = [...reordered, ...missing];

    await this.tasksRepository.save(task);
    return this.freshDetail(id);
  }

  /**
   * The one place a task's status changes — the board's drag, and the detail view's
   * status dropdown alike (the latter just omits beforeId/afterId, which appends to the
   * end of the new column). See UpdateTaskDto for why status has no place there.
   */
  async move(id: number, dto: MoveTaskDto, actor: TaskActor): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    const fromStatus = task.status;
    const toStatus = dto.status;
    let blockedReason: string | null = null;

    if (toStatus === 'blocked') {
      blockedReason = dto.blockedReason?.trim() || task.blockedReason || null;
      if (!blockedReason) throw new TaskBlockedReasonRequiredException();
      task.blockedReason = blockedReason;
    } else if (fromStatus === 'blocked') {
      task.blockedReason = null;
    }

    if (toStatus === 'done' && fromStatus !== 'done') {
      task.completedAt = new Date();
    } else if (fromStatus === 'done' && toStatus !== 'done') {
      task.completedAt = null;
    }

    task.status = toStatus;

    // A subtask's position is scoped to its parent and untouched here — no reordering
    // endpoint exists for it yet (see TasksRepository.getMaxPositionUnderParent). Only
    // a top-level task's board-column position is resolved from beforeId/afterId.
    if (!task.parent) {
      task.position = await this.resolveColumnPosition(id, toStatus, dto.beforeId, dto.afterId);
    }

    await this.tasksRepository.save(task);

    let openSubtasks: number | undefined;

    if (fromStatus !== toStatus) {
      await this.taskActivity.logStatusChanged(id, actor.id, fromStatus, toStatus);
      this.eventEmitter.emit('task.status_changed', {
        taskId: id,
        actorId: actor.id,
        from: fromStatus,
        to: toStatus,
      });

      if (toStatus === 'blocked') {
        await this.taskActivity.logBlocked(id, actor.id, blockedReason as string);
        this.eventEmitter.emit('task.blocked', {
          taskId: id,
          actorId: actor.id,
          reason: blockedReason,
        });
      } else if (fromStatus === 'blocked') {
        await this.taskActivity.logUnblocked(id, actor.id);
      }

      // Closing a task with subtasks still open is allowed — construction work often
      // closes the parent (the punch list item is done) slightly ahead of paperwork
      // catching up on every child. The caller just gets told, and decides.
      if (toStatus === 'done' && !task.parent) {
        openSubtasks = await this.tasksRepository.countOpenChildren(id);
      }
    }

    const detail = await this.freshDetail(id);
    return openSubtasks ? { ...detail, openSubtasksWarning: openSubtasks } : detail;
  }

  private async resolveColumnPosition(
    taskId: number,
    status: TaskStatus,
    beforeId?: number | null,
    afterId?: number | null,
  ): Promise<number> {
    let siblings = await this.tasksRepository.getSiblingsInColumn(status, taskId);
    let position = computeInsertPosition(siblings, POSITION_STEP, beforeId, afterId);

    if (position === null) {
      // Gap exhausted between neighbors — rebalance this column to clean multiples of
      // the step, then retry once against the fresh positions.
      await this.tasksRepository.rebalanceSiblings(
        siblings.map((s) => s.id),
        POSITION_STEP,
      );
      siblings = await this.tasksRepository.getSiblingsInColumn(status, taskId);
      position = computeInsertPosition(siblings, POSITION_STEP, beforeId, afterId);
    }

    return position ?? POSITION_STEP;
  }

  async setAssignee(id: number, dto: SetAssigneeDto, actor: TaskActor): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    const previousAssigneeId = task.assigneeUserId ?? null;
    if (previousAssigneeId === dto.userId) return this.freshDetail(id);

    task.assigneeUserId = dto.userId;
    await this.tasksRepository.save(task);

    if (dto.userId != null) {
      await this.taskActivity.logAssigned(id, actor.id, dto.userId);
      await this.taskWatchersRepository.addMany(id, [dto.userId]);
      this.eventEmitter.emit('task.assigned', {
        taskId: id,
        assigneeUserId: dto.userId,
        actorId: actor.id,
      });
    } else {
      await this.taskActivity.logUnassigned(id, actor.id, previousAssigneeId);
    }

    return this.freshDetail(id);
  }

  async setLabels(id: number, dto: SetLabelsDto): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);
    task.labels = await this.taskLabelsRepository.findByIds(dto.labelIds);
    await this.tasksRepository.save(task);
    return this.freshDetail(id);
  }

  async setEntityLink(id: number, dto: SetEntityDto, actor: TaskActor): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);

    if (dto.entityKind === null) {
      task.entityKind = null;
      task.entityId = null;
      await this.tasksRepository.save(task);
      await this.taskActivity.logEntityUnlinked(id, actor.id);
    } else {
      task.entityKind = dto.entityKind;
      task.entityId = dto.entityId;
      await this.tasksRepository.save(task);
      await this.taskActivity.logEntityLinked(id, actor.id, dto.entityKind, dto.entityId as number);
    }

    return this.freshDetail(id);
  }

  /** Soft delete. Direct subtasks go with it (one level, no recursion) — see PLAN-TAREAS.md section 0.5. */
  async delete(id: number): Promise<void> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new TaskNotFoundException(id);
    await this.tasksRepository.softDeleteWithChildren(id);
  }
}
