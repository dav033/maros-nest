import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Task } from '../../../entities/task.entity';
import { User } from '../../../entities/user.entity';
import { TasksRepository } from '../task-management/repositories/tasks.repository';
import { TaskMapper } from '../task-management/mappers/task.mapper';
import { MailService } from '../../mail/services/mail.service';

interface DigestEntry {
  user: User;
  overdue: Task[];
  dueToday: Task[];
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
  ) {}

  @Cron('0 7 * * *', { name: 'task-digest', timeZone: 'America/New_York' })
  async sendDailyDigest(): Promise<void> {
    try {
      const today = TaskMapper.todayInBusinessTimezone();
      const dueTasks = await this.tasksRepository.findDueForDigest(today);
      if (dueTasks.length === 0) return;

      const entries = Array.from(this.groupByAssignee(dueTasks, today).values());
      const sent = await Promise.all(entries.map((entry) => this.sendDigestEmail(entry)));

      this.logger.log(
        `Daily digest: sent ${sent.filter(Boolean).length}/${entries.length} email(s) ` +
          `for ${dueTasks.length} due task(s)`,
      );
    } catch (error) {
      this.logger.error(
        `Daily digest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private groupByAssignee(tasks: Task[], today: string): Map<number, DigestEntry> {
    const byAssignee = new Map<number, DigestEntry>();
    for (const task of tasks) {
      if (!task.assignee) continue;
      let entry = byAssignee.get(task.assignee.id);
      if (!entry) {
        entry = { user: task.assignee, overdue: [], dueToday: [] };
        byAssignee.set(task.assignee.id, entry);
      }
      if (this.taskMapper.formatDate(task.dueDate) === today) {
        entry.dueToday.push(task);
      } else {
        entry.overdue.push(task);
      }
    }
    return byAssignee;
  }

  /** Never throws — a bounced email for one person must not cost everyone else theirs. */
  private async sendDigestEmail(entry: DigestEntry): Promise<boolean> {
    if (!entry.user.email) return false;
    try {
      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ?? 'https://marosconstruction.com';
      const total = entry.overdue.length + entry.dueToday.length;

      const lines: string[] = [];
      if (entry.overdue.length > 0) {
        lines.push(`Overdue (${entry.overdue.length}):`);
        lines.push(...entry.overdue.map((t) => `  - ${t.title} (T-${t.id})`));
        lines.push('');
      }
      if (entry.dueToday.length > 0) {
        lines.push(`Due today (${entry.dueToday.length}):`);
        lines.push(...entry.dueToday.map((t) => `  - ${t.title} (T-${t.id})`));
        lines.push('');
      }
      lines.push(`${frontendUrl}/tasks/mine`);

      const result = await this.mailService.sendMail({
        to: [entry.user.email],
        subject: `${total} task${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} attention`,
        text: lines.join('\n'),
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
}
