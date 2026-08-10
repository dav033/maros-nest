import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../entities/task.entity';
import { TaskLabel } from '../../entities/task-label.entity';
import { TaskActivity } from '../../entities/task-activity.entity';
import { TaskWatcher } from '../../entities/task-watcher.entity';
import { TasksRepository } from './task-management/repositories/tasks.repository';
import { TaskLabelsRepository } from './task-management/repositories/task-labels.repository';
import { TaskActivityRepository } from './task-management/repositories/task-activity.repository';
import { TaskWatchersRepository } from './task-management/repositories/task-watchers.repository';
import { TasksService } from './task-management/tasks.service';
import { TaskLabelsService } from './task-management/services/task-labels.service';
import { TaskActivityService } from './task-management/services/task-activity.service';
import { TaskMapper } from './task-management/mappers/task.mapper';
import { TasksController } from './task-management/tasks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Task, TaskLabel, TaskActivity, TaskWatcher])],
  controllers: [TasksController],
  providers: [
    TasksRepository,
    TaskLabelsRepository,
    TaskActivityRepository,
    TaskWatchersRepository,
    TasksService,
    TaskLabelsService,
    TaskActivityService,
    TaskMapper,
  ],
  exports: [TasksRepository, TasksService],
})
export class TasksModule {}
