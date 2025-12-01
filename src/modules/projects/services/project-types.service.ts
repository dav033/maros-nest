import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectType } from '../../../entities/project-type.entity';
import { ProjectTypesRepository } from '../repositories/project-types.repository';
import { ProjectTypeMapper } from '../mappers/project-type.mapper';
import { BaseService } from '../../../common/services/base.service';

@Injectable()
export class ProjectTypesService extends BaseService<any, number, ProjectType> {
  constructor(
    private readonly projectTypesRepository: ProjectTypesRepository,
    @InjectRepository(ProjectType)
    private readonly projectTypeRepo: Repository<ProjectType>,
    private readonly projectTypeMapper: ProjectTypeMapper,
  ) {
    super(projectTypeRepo, projectTypeMapper);
  }
}
