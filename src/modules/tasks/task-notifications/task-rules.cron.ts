import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../../notifications/notifications.service';
import { TasksRepository } from '../task-management/repositories/tasks.repository';
import { TaskMapper } from '../task-management/mappers/task.mapper';
import { UsersRepository } from '../../users/user-management/repositories/users.repository';
import { MailService } from '../../mail/services/mail.service';
import { ConfigService } from '@nestjs/config';
import { renderTaskPermitReminderEmail, taskEmailDetails } from './task-email-templates';
import type { Task } from '../../../entities/task.entity';

@Injectable()
export class TaskRulesCron {
  private readonly logger = new Logger(TaskRulesCron.name);

  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly notificationsService: NotificationsService,
    private readonly usersRepository: UsersRepository,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /** Small, explicit rules from the refactor plan; no generic automation engine. */
  @Cron('30 6 * * *', { name: 'task-rules', timeZone: 'America/New_York' })
  async run(): Promise<void> {
    const today = TaskMapper.todayInBusinessTimezone();
    const targetDate = this.shiftDate(today, 3);
    const candidates = await this.tasksRepository.findPermitTasksDueOn(targetDate);
    let sent = 0;
    for (const task of candidates) {
      if (!task.reporterId || !task.reporter) continue;
      const channel = (await this.usersRepository.findNotificationPreferences(task.reporterId)).permit ?? 'in_app';
      if (channel === 'none') continue;
      const payload = { taskId: task.id, taskTitle: task.title, dueDate: targetDate, rule: 'permit_due_in_three_days' };
      if (channel === 'in_app') {
        await this.notificationsService.create({
          userId: task.reporterId,
          kind: 'task_permit_due',
          actorId: null,
          entityKind: 'task',
          entityId: task.id,
          payload,
        });
      } else {
        await this.sendPermitEmail(task, task.reporter.email);
      }
      sent += 1;
    }
    if (sent) this.logger.log(`Task rules emitted ${sent} signal(s)`);
  }

  private async sendPermitEmail(task: Task, address?: string): Promise<void> {
    if (!address) return;
    const email = renderTaskPermitReminderEmail({
      taskTitle: task.title,
      taskId: task.id,
      taskUrl: this.taskUrl(task.id),
      taskDetails: taskEmailDetails(task),
    });
    await this.mailService.sendMail({ to: [address], ...email });
  }

  private taskUrl(taskId: number): string {
    const appUrl =
      this.configService.get<string>('TASK_APP_URL')?.trim() || 'https://app.marosconstruction.com';
    return `${appUrl.replace(/\/+$/, '')}/tasks?task=${taskId}`;
  }

  private shiftDate(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }
}
