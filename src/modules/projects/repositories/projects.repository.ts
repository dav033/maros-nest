import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../entities/project.entity';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
  ) {}

  async findByProjectProgressStatus(status: ProjectProgressStatus): Promise<Project[]> {
    return this.repo.find({ where: { projectProgressStatus: status } });
  }

  async findProjectsWithLeadAndContact(): Promise<Project[]> {
    return this.repo.createQueryBuilder('project')
      .innerJoinAndSelect('project.lead', 'lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .getMany();
  }

  async countProjectsWithLead(): Promise<number> {
    return this.repo.createQueryBuilder('project')
      .innerJoin('project.lead', 'lead')
      .getCount();
  }

  async findByLeadId(leadId: number): Promise<Project[]> {
    return this.repo.find({ where: { lead: { id: leadId } } });
  }

  async save(project: Project): Promise<Project> {
    return this.repo.save(project);
  }

  async findOne(id: number): Promise<Project | null> {
    return this.repo.findOne({ where: { id } });
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
