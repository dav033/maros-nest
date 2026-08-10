import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../../notifications/notifications.service';
import { MailService } from '../../mail/services/mail.service';
import { UsersRepository } from '../../users/user-management/repositories/users.repository';
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
 * Turns task.* events into in-app notifications, plus one immediate email —
 * assignment, and only assignment. Per PLAN-TAREAS.md's mail policy: a crew that gets
 * a message for every comment stops reading messages. Status changes, blocks and
 * comments stay in-app only; the daily digest (TaskDigestCron) is the other mail this
 * feature sends.
 *
 * Every handler is wrapped in try/catch: a failed notification insert or a bounced
 * email is not a reason to surface an error anywhere near the task mutation that
 * triggered it (which has already committed and responded by the time this runs) or to
 * become an unhandled rejection — EventEmitter2's default synchronous emit does not
 * await listeners.
 */
@Injectable()
export class TaskNotificationsListener {
  private readonly logger = new Logger(TaskNotificationsListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly taskWatchersRepository: TaskWatchersRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly usersRepository: UsersRepository,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
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
      await this.sendAssignmentEmail(event.assigneeUserId, task.id, task.title);
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

  /**
   * A bounced or misconfigured mail server must not make the assignment itself look
   * failed — the in-app notification above already landed by the time this runs, so
   * this failure gets its own log line, separate from `safely`'s.
   */
  private async sendAssignmentEmail(
    assigneeUserId: number,
    taskId: number,
    taskTitle: string,
  ): Promise<void> {
    try {
      const assignee = await this.usersRepository.findById(assigneeUserId);
      if (!assignee?.email) return;

      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ?? 'https://marosconstruction.com';
      const taskUrl = `${frontendUrl}/tasks?task=${taskId}`;

      const result = await this.mailService.sendMail({
        to: [assignee.email],
        subject: `Task assigned: ${taskTitle}`,
        text: `You were assigned "${taskTitle}" (T-${taskId}).\n\n${taskUrl}`,
      });
      this.logger.log(
        `Assignment email sent to ${assignee.email} — messageId: ${result.messageId ?? 'N/A'}`,
      );
    } catch (error) {
      this.logger.warn(
        `Assignment email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
