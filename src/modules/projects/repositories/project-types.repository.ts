import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectType } from '../../../entities/project-type.entity';

@Injectable()
export class ProjectTypesRepository {
  constructor(
    @InjectRepository(ProjectType)
    private readonly repo: Repository<ProjectType>,
  ) {}

  async findAll(): Promise<ProjectType[]> {
    return this.repo.find();
  }

  async save(projectType: ProjectType): Promise<ProjectType> {
    return this.repo.save(projectType);
  }

  async findOne(id: number): Promise<ProjectType | null> {
    return this.repo.findOne({ where: { id } });
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
