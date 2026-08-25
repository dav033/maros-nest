import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { Contact } from '../../entities/contact.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { Task } from '../../entities/task.entity';
import { TaskFile } from '../../entities/task-file.entity';
import { TaskWorkspace } from '../../entities/task-workspace.entity';
import { TaskWorkspaceFolder } from '../../entities/task-workspace-folder.entity';
import { TaskWorkspaceLink } from '../../entities/task-workspace-link.entity';
import { TaskWorkspaceOptionsController } from './task-workspace-options.controller';
import { TaskWorkspacesController } from './task-workspaces.controller';
import { TaskWorkspaceFoldersController } from './task-workspace-folders.controller';
import { TaskWorkspaceMapper } from './mappers/task-workspace.mapper';
import { TaskWorkspacesRepository } from './repositories/task-workspaces.repository';
import { TaskWorkspaceAssignmentService } from './services/task-workspace-assignment.service';
import { TaskWorkspacesService } from './services/task-workspaces.service';
import { TaskWorkspaceFoldersService } from './services/task-workspace-folders.service';
import { TaskWorkspaceLinkResolverService } from './services/task-workspace-link-resolver.service';
import { TaskWorkspaceFoldersRepository } from './repositories/task-workspace-folders.repository';

@Module({
  imports: [TypeOrmModule.forFeature([TaskWorkspace, TaskWorkspaceFolder, TaskWorkspaceLink, TaskFile, Task, Lead, Project, Contact, Company])],
  controllers: [TaskWorkspaceOptionsController, TaskWorkspacesController, TaskWorkspaceFoldersController],
  providers: [TaskWorkspacesRepository, TaskWorkspaceFoldersRepository, TaskWorkspaceAssignmentService, TaskWorkspaceMapper, TaskWorkspacesService, TaskWorkspaceFoldersService, TaskWorkspaceLinkResolverService],
  exports: [TaskWorkspacesRepository, TaskWorkspaceAssignmentService, TaskWorkspaceMapper, TypeOrmModule],
})
export class TaskWorkspacesModule {}
