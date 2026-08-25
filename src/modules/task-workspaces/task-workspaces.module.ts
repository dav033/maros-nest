import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { Contact } from '../../entities/contact.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { Task } from '../../entities/task.entity';
import { TaskWorkspace } from '../../entities/task-workspace.entity';
import { TaskWorkspaceFolder } from '../../entities/task-workspace-folder.entity';
import { TaskWorkspaceLink } from '../../entities/task-workspace-link.entity';
import { TaskWorkspaceOptionsController } from './task-workspace-options.controller';
import { TaskWorkspaceMapper } from './mappers/task-workspace.mapper';
import { TaskWorkspacesRepository } from './repositories/task-workspaces.repository';
import { TaskWorkspaceAssignmentService } from './services/task-workspace-assignment.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskWorkspace, TaskWorkspaceFolder, TaskWorkspaceLink, Task, Lead, Project, Contact, Company])],
  controllers: [TaskWorkspaceOptionsController],
  providers: [TaskWorkspacesRepository, TaskWorkspaceAssignmentService, TaskWorkspaceMapper],
  exports: [TaskWorkspacesRepository, TaskWorkspaceAssignmentService, TaskWorkspaceMapper, TypeOrmModule],
})
export class TaskWorkspacesModule {}
