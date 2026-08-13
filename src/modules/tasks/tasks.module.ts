import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../entities/task.entity';
import { TaskLabel } from '../../entities/task-label.entity';
import { TaskActivity } from '../../entities/task-activity.entity';
import { TaskWatcher } from '../../entities/task-watcher.entity';
import { TaskComment } from '../../entities/task-comment.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { TasksRepository } from './task-management/repositories/tasks.repository';
import { TaskLabelsRepository } from './task-management/repositories/task-labels.repository';
import { TaskActivityRepository } from './task-management/repositories/task-activity.repository';
import { TaskWatchersRepository } from './task-management/repositories/task-watchers.repository';
import { TaskCommentsRepository } from './task-management/repositories/task-comments.repository';
import { TasksService } from './task-management/tasks.service';
import { TaskLabelsService } from './task-management/services/task-labels.service';
import { TaskActivityService } from './task-management/services/task-activity.service';
import { TaskCommentsService } from './task-management/services/task-comments.service';
import { TaskEntityResolverService } from './task-management/services/task-entity-resolver.service';
import { TaskMapper } from './task-management/mappers/task.mapper';
import { TasksController } from './task-management/tasks.controller';
import { TaskNotificationsListener } from './task-notifications/task-notifications.listener';
import { TaskDigestCron } from './task-notifications/task-digest.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskLabel,
      TaskActivity,
      TaskWatcher,
      TaskComment,
      Lead,
      Project,
      Contact,
      Company,
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksRepository,
    TaskLabelsRepository,
    TaskActivityRepository,
    TaskWatchersRepository,
    TaskCommentsRepository,
    TasksService,
    TaskLabelsService,
    TaskActivityService,
    TaskCommentsService,
    TaskEntityResolverService,
    TaskMapper,
    TaskNotificationsListener,
    TaskDigestCron,
  ],
  exports: [TasksRepository, TasksService],
})
export class TasksModule {}
