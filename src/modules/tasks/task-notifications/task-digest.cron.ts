import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Task } from '../../../entities/task.entity';
import { User } from '../../../entities/user.entity';
import { TasksRepository } from '../task-management/repositories/tasks.repository';
import { TaskMapper } from '../task-management/mappers/task.mapper';
import { MailService } from '../../mail/services/mail.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { UsersRepository } from '../../users/user-management/repositories/users.repository';
import { renderTaskDigestEmail } from './task-email-templates';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../../entities/user.entity';
import type { NotificationChannel } from '../../../entities/user.entity';

interface DigestEntry {
  user: User;
  overdue: Task[];
  dueToday: Task[];
  blocked: Task[];
}

/**
 * One email per user, every morning, listing what's overdue and what's due today —
 * separate from the assignment email (TaskNotificationsListener), which fires
 * per-event. Per PLAN-TAREAS.md's mail policy: users with nothing due get no email —
 * a digest that's usually empty trains people to stop opening it.
 */
@Injectable()
export class TaskDigestCron {
  private readonly logger = new Logger(TaskDigestCron.name);

  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly taskMapper: TaskMapper,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly usersRepository?: UsersRepository,
  ) {}

  @Cron('0 * * * *', { name: 'task-digest', timeZone: 'America/New_York' })
  async sendDailyDigest(): Promise<void> {
    try {
      const today = TaskMapper.todayInBusinessTimezone();
      const blockedSince = this.shiftDate(today, -3);
      const dueTasks = this.tasksRepository.findSignalsForDigest
        ? await this.tasksRepository.findSignalsForDigest(today, blockedSince)
        : await this.tasksRepository.findDueForDigest(today);
      if (dueTasks.length === 0) return;

      const entries = Array.from(this.groupByAssignee(dueTasks, today, blockedSince).values());
      const currentHour = TaskMapper.currentHourInBusinessTimezone();
      const sent = await Promise.all(entries.map(async (entry) => {
        const preferences = this.usersRepository
          ? await this.usersRepository.findNotificationPreferences(entry.user.id)
          : DEFAULT_NOTIFICATION_PREFERENCES;
        if (this.usersRepository && preferences.digestHour !== currentHour) return false;
        return this.sendDigest(entry, preferences.digest ?? 'email');
      }));

      this.logger.log(
        `Daily digest: sent ${sent.filter(Boolean).length}/${entries.length} email(s) ` +
        `for ${dueTasks.length} task signal(s)`,
      );
    } catch (error) {
      this.logger.error(
        `Daily digest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private groupByAssignee(tasks: Task[], today: string, blockedSince: string): Map<number, DigestEntry> {
    const byAssignee = new Map<number, DigestEntry>();
    for (const task of tasks) {
      if (!task.assignee) continue;
      let entry = byAssignee.get(task.assignee.id);
      if (!entry) {
        entry = { user: task.assignee, overdue: [], dueToday: [], blocked: [] };
        byAssignee.set(task.assignee.id, entry);
      }
      const blockedAt = this.taskMapper.formatDate(task.blockedAt);
      if (task.status === 'blocked' && blockedAt != null && blockedAt <= blockedSince) {
        entry.blocked.push(task);
      } else if (this.taskMapper.formatDate(task.dueDate) === today) {
        entry.dueToday.push(task);
      } else {
        entry.overdue.push(task);
      }
    }
    return byAssignee;
  }

  /** Never throws — a bounced email for one person must not cost everyone else theirs. */
  private async sendDigest(entry: DigestEntry, channel: NotificationChannel): Promise<boolean> {
    if (channel === 'none') return false;
    if (channel === 'in_app') {
      if (!this.notificationsService) return false;
      const tasks = [...entry.overdue, ...entry.dueToday, ...entry.blocked];
      await Promise.all(tasks.map((task) => this.notificationsService!.create({
        userId: entry.user.id,
        kind: 'task_due_digest',
        actorId: null,
        entityKind: 'task',
        entityId: task.id,
        payload: { taskId: task.id, taskTitle: task.title, rule: 'daily_digest' },
      })));
      return tasks.length > 0;
    }
    if (!entry.user.email) return false;
    try {
      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ?? 'https://marosconstruction.com';
      const total = entry.overdue.length + entry.dueToday.length + entry.blocked.length;
      const { subject, text, html } = renderTaskDigestEmail({
        overdue: entry.overdue.map((t) => ({ id: t.id, title: t.title })),
        dueToday: entry.dueToday.map((t) => ({ id: t.id, title: t.title })),
        blocked: entry.blocked.map((t) => ({ id: t.id, title: t.title })),
        tasksUrl: `${frontendUrl}/tasks/mine`,
      });

      const result = await this.mailService.sendMail({
        to: [entry.user.email],
        subject,
        text,
        html,
      });
      this.logger.log(
        `Digest sent to ${entry.user.email} — ${total} task(s), messageId: ${result.messageId ?? 'N/A'}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Digest email failed for user ${entry.user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private shiftDate(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

}
