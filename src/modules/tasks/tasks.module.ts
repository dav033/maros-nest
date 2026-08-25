import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../entities/task.entity';
import { TaskLabel } from '../../entities/task-label.entity';
import { TaskActivity } from '../../entities/task-activity.entity';
import { TaskWatcher } from '../../entities/task-watcher.entity';
import { TaskComment } from '../../entities/task-comment.entity';
import { TaskParty } from '../../entities/task-party.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { TaskTemplate } from '../../entities/task-template.entity';
import { TaskTemplateItem } from '../../entities/task-template-item.entity';
import { TaskDependency } from '../../entities/task-dependency.entity';
import { TaskSavedView } from '../../entities/task-saved-view.entity';
import { TaskWorkspace } from '../../entities/task-workspace.entity';
import { TaskWorkspaceLink } from '../../entities/task-workspace-link.entity';
import { TaskWorkspaceFolder } from '../../entities/task-workspace-folder.entity';
import { TaskFile } from '../../entities/task-file.entity';
import { TaskWorkspacesModule } from '../task-workspaces/task-workspaces.module';
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
import { TaskPartiesService } from './task-management/services/task-parties.service';
import { TaskEventsBridgeService } from './task-management/services/task-events-bridge.service';
import { TaskMapper } from './task-management/mappers/task.mapper';
import { TasksController } from './task-management/tasks.controller';
import { TaskTemplatesController } from './task-management/task-templates.controller';
import { TaskNotificationsListener } from './task-notifications/task-notifications.listener';
import { TaskDigestCron } from './task-notifications/task-digest.cron';
import { TaskRulesCron } from './task-notifications/task-rules.cron';
import { TaskTemplatesService } from './task-management/services/task-templates.service';
import { TaskDependenciesService } from './task-management/services/task-dependencies.service';
import { TaskSavedViewsService } from './task-management/services/task-saved-views.service';
import { TaskSavedViewsController } from './task-management/task-saved-views.controller';

@Module({
  imports: [
    TaskWorkspacesModule,
    TypeOrmModule.forFeature([
      Task,
      TaskLabel,
      TaskActivity,
      TaskWatcher,
      TaskComment,
      TaskParty,
      Lead,
      Project,
      Contact,
      Company,
      TaskTemplate,
      TaskTemplateItem,
      TaskDependency,
      TaskSavedView,
      TaskWorkspace,
      TaskWorkspaceLink,
      TaskWorkspaceFolder,
      TaskFile,
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [TasksController, TaskTemplatesController, TaskSavedViewsController],
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
    TaskPartiesService,
    TaskEntityResolverService,
    TaskEventsBridgeService,
    TaskMapper,
    TaskNotificationsListener,
    TaskDigestCron,
    TaskRulesCron,
    TaskTemplatesService,
    TaskDependenciesService,
    TaskSavedViewsService,
  ],
  exports: [TasksRepository, TasksService, TaskTemplatesService, TaskWorkspacesModule],
})
export class TasksModule {}
