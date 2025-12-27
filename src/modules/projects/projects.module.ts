import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../../entities/project.entity';
import { Lead } from '../../entities/lead.entity';
import { ProjectType } from '../../entities/project-type.entity';
import { ProjectsRepository } from './repositories/projects.repository';
import { ProjectTypesRepository } from './repositories/project-types.repository';
import { ProjectsService } from './services/projects.service';
import { ProjectTypesService } from './services/project-types.service';
import { ProjectsController } from './projects.controller';
import { ProjectTypeController, ProjectTypesController } from './project-types.controller';
import { ProjectMapper } from './mappers/project.mapper';
import { ProjectTypeMapper } from './mappers/project-type.mapper';
import { N8nModule } from '../n8n/n8n.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Lead, ProjectType]),
    N8nModule,
  ],
  controllers: [ProjectsController, ProjectTypeController, ProjectTypesController],
  providers: [
    ProjectsRepository,
    ProjectTypesRepository,
    ProjectsService,
    ProjectTypesService,
    ProjectMapper,
    ProjectTypeMapper,
  ],
  exports: [ProjectsService, ProjectTypesService],
})
export class ProjectsModule {}
