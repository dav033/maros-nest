import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../entities/project.entity';
import { Lead } from '../../../entities/lead.entity';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectMapper } from '../mappers/project.mapper';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { ValidationException, ResourceNotFoundException } from '../../../common/exceptions';
import { BaseService } from '../../../common/services/base.service';

@Injectable()
export class ProjectsService extends BaseService<any, number, Project> {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly projectsRepository: ProjectsRepository,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    private readonly projectMapper: ProjectMapper,
  ) {
    super(projectRepo, projectMapper);
  }

  async create(dto: CreateProjectDto): Promise<any> {
    // Validate that lead exists
    const lead = await this.leadRepo.findOne({ where: { id: dto.leadId } });
    if (!lead) {
      throw ValidationException.format('Lead not found with id: %s', dto.leadId.toString());
    }

    // Check if lead already has a project (1:1 relationship)
    const existingProject = await this.projectRepo.findOne({ 
      where: { lead: { id: dto.leadId } },
      relations: ['lead']
    });
    if (existingProject) {
      throw ValidationException.format('Lead with id %s already has a project', dto.leadId.toString());
    }

    const entity = this.projectMapper.toEntity(dto);
    entity.lead = lead;

    const saved = await this.projectRepo.save(entity);
    return this.projectMapper.toDto(saved);
  }

  async update(id: number, dto: UpdateProjectDto): Promise<any> {
    const entity = await this.projectRepo.findOne({ 
      where: { id }, 
      relations: ['lead'] 
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    // If leadId is being updated, validate the new lead
    if (dto.leadId !== undefined && dto.leadId !== entity.lead.id) {
      const newLead = await this.leadRepo.findOne({ where: { id: dto.leadId } });
      if (!newLead) {
        throw ValidationException.format('Lead not found with id: %s', dto.leadId.toString());
      }

      // Check if the new lead already has a project
      const existingProject = await this.projectRepo.findOne({ 
        where: { lead: { id: dto.leadId } }
      });
      if (existingProject && existingProject.id !== id) {
        throw ValidationException.format('Lead with id %s already has a project', dto.leadId.toString());
      }

      entity.lead = newLead;
    }

    this.projectMapper.updateEntity(dto, entity);
    const saved = await this.projectRepo.save(entity);
    return this.projectMapper.toDto(saved);
  }

  async findAll(): Promise<any[]> {
    const entities = await this.projectRepo.find({ 
      relations: ['lead', 'lead.contact', 'lead.projectType'] 
    });
    return entities.map((entity) => this.projectMapper.toDto(entity));
  }

  async findById(id: number): Promise<any> {
    const entity = await this.projectRepo.findOne({ 
      where: { id }, 
      relations: ['lead', 'lead.contact', 'lead.projectType'] 
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }
    return this.projectMapper.toDto(entity);
  }

  async findByLeadNumber(leadNumber: string): Promise<any> {
    const entity = await this.projectsRepository.findByLeadNumber(leadNumber);
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with leadNumber: ${leadNumber}`);
    }
    return this.projectMapper.toDto(entity);
  }
}
