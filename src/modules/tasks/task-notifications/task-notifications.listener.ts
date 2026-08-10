import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../../notifications/notifications.service';
import { TaskWatchersRepository } from '../task-management/repositories/task-watchers.repository';
import { TasksRepository } from '../task-management/repositories/tasks.repository';
import type { NotificationKind } from '../../../entities/notification.entity';

interface TaskAssignedEvent {
  taskId: number;
  assigneeUserId: number;
  actorId: number;
}

interface TaskStatusChangedEvent {
  taskId: number;
  actorId: number;
  from: string;
  to: string;
}

interface TaskBlockedEvent {
  taskId: number;
  actorId: number;
  reason: string;
}

interface TaskCommentedEvent {
  taskId: number;
  commentId: number;
  actorId: number;
}

/**
 * Turns task.* events into in-app notifications. No email here yet — that's the digest
 * and the immediate assignment mail, both PLAN-TAREAS.md PR6.
 *
 * Every handler is wrapped in try/catch: a failed notification insert is not a reason to
 * surface an error anywhere near the task mutation that triggered it (which has already
 * committed and responded by the time this runs) or to become an unhandled rejection —
 * EventEmitter2's default synchronous emit does not await listeners.
 */
@Injectable()
export class TaskNotificationsListener {
  private readonly logger = new Logger(TaskNotificationsListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly taskWatchersRepository: TaskWatchersRepository,
    private readonly tasksRepository: TasksRepository,
  ) {}

  @OnEvent('task.assigned')
  async onAssigned(event: TaskAssignedEvent): Promise<void> {
    // Assigning yourself a task is not news to you.
    if (event.assigneeUserId === event.actorId) return;
    await this.safely('task.assigned', async () => {
      const task = await this.tasksRepository.findByIdActive(event.taskId);
      if (!task) return;
      await this.notificationsService.create({
        userId: event.assigneeUserId,
        kind: 'task_assigned',
        actorId: event.actorId,
        entityKind: 'task',
        entityId: event.taskId,
        payload: { taskId: event.taskId, taskTitle: task.title },
      });
    });
  }

  @OnEvent('task.status_changed')
  async onStatusChanged(event: TaskStatusChangedEvent): Promise<void> {
    await this.safely('task.status_changed', async () => {
      const task = await this.tasksRepository.findByIdActive(event.taskId);
      if (!task) return;
      await this.notifyWatchers(event.taskId, event.actorId, 'task_status_changed', {
        taskId: event.taskId,
        taskTitle: task.title,
        from: event.from,
        to: event.to,
      });
    });
  }

  @OnEvent('task.blocked')
  async onBlocked(event: TaskBlockedEvent): Promise<void> {
    await this.safely('task.blocked', async () => {
      const task = await this.tasksRepository.findByIdActive(event.taskId);
      if (!task) return;
      await this.notifyWatchers(event.taskId, event.actorId, 'task_blocked', {
        taskId: event.taskId,
        taskTitle: task.title,
        reason: event.reason,
      });
    });
  }

  @OnEvent('task.commented')
  async onCommented(event: TaskCommentedEvent): Promise<void> {
    await this.safely('task.commented', async () => {
      const task = await this.tasksRepository.findByIdActive(event.taskId);
      if (!task) return;
      await this.notifyWatchers(event.taskId, event.actorId, 'task_commented', {
        taskId: event.taskId,
        taskTitle: task.title,
        commentId: event.commentId,
      });
    });
  }

  /** Every watcher except whoever caused the event — nobody needs telling about their own action. */
  private async notifyWatchers(
    taskId: number,
    actorId: number,
    kind: NotificationKind,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const watcherIds = await this.taskWatchersRepository.findUserIdsForTask(taskId);
    const recipients = watcherIds.filter((id) => id !== actorId);
    await Promise.all(
      recipients.map((userId) =>
        this.notificationsService.create({
          userId,
          kind,
          actorId,
          entityKind: 'task',
          entityId: taskId,
          payload,
        }),
      ),
    );
  }

  private async safely(event: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Failed to process ${event}: ${String(error)}`);
    }
  }
}
