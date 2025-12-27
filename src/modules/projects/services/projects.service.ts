import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../entities/project.entity';
import { Lead } from '../../../entities/lead.entity';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectMapper } from '../mappers/project.mapper';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import {
  ValidationException,
  ResourceNotFoundException,
} from '../../../common/exceptions';
import { BaseService } from '../../../common/services/base.service';
import { N8nService } from '../../n8n/services/n8n.service';

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
    private readonly n8nService: N8nService,
  ) {
    super(projectRepo, projectMapper);
  }

  async create(dto: CreateProjectDto): Promise<any> {
    // Validate that lead exists
    const lead = await this.leadRepo.findOne({ where: { id: dto.leadId } });
    if (!lead) {
      throw ValidationException.format(
        'Lead not found with id: %s',
        dto.leadId.toString(),
      );
    }

    // Check if lead already has a project (1:1 relationship)
    const existingProject = await this.projectRepo.findOne({
      where: { lead: { id: dto.leadId } },
      relations: ['lead'],
    });
    if (existingProject) {
      throw ValidationException.format(
        'Lead with id %s already has a project',
        dto.leadId.toString(),
      );
    }

    const entity = this.projectMapper.toEntity(dto);
    entity.lead = lead;

    const saved = await this.projectRepo.save(entity);
    return this.projectMapper.toDto(saved);
  }

  async update(id: number, dto: UpdateProjectDto): Promise<any> {
    const entity = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead'],
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    // If leadId is being updated, validate the new lead
    if (dto.leadId !== undefined && dto.leadId !== entity.lead.id) {
      const newLead = await this.leadRepo.findOne({
        where: { id: dto.leadId },
      });
      if (!newLead) {
        throw ValidationException.format(
          'Lead not found with id: %s',
          dto.leadId.toString(),
        );
      }

      // Check if the new lead already has a project
      const existingProject = await this.projectRepo.findOne({
        where: { lead: { id: dto.leadId } },
      });
      if (existingProject && existingProject.id !== id) {
        throw ValidationException.format(
          'Lead with id %s already has a project',
          dto.leadId.toString(),
        );
      }

      entity.lead = newLead;
    }

    this.projectMapper.updateEntity(dto, entity);
    const saved = await this.projectRepo.save(entity);
    return this.projectMapper.toDto(saved);
  }

  async findAll(): Promise<any[]> {
    const entities = await this.projectRepo.find({
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });
    
    // Extract project numbers from leads
    const projectNumbers = entities
      .map((entity) => entity.lead?.leadNumber)
      .filter((number): number is string => !!number);
    
    // Get financial information from n8n for all projects
    let financialData: Map<string, any> = new Map();
    if (projectNumbers.length > 0) {
      try {
        const financials = await this.n8nService.getProjectFinancials(projectNumbers);
        financialData = new Map(
          financials.map((financial) => [financial.projectNumber, financial]),
        );
        this.logger.log(
          `Retrieved financial data for ${financials.length} projects from n8n`,
        );
      } catch (error: any) {
        this.logger.error(
          `Error fetching financial data from n8n: ${error.message}`,
        );
        // Continue without financial data rather than failing
      }
    }
    
    // Map entities to DTOs and include financial information
    return entities.map((entity) => {
      const dto = this.projectMapper.toDto(entity);
      const leadNumber = entity.lead?.leadNumber;
      if (leadNumber && financialData.has(leadNumber)) {
        dto.financial = financialData.get(leadNumber);
      }
      return dto;
    });
  }

  async findById(id: number): Promise<any> {
    const entity = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }
    
    const dto = this.projectMapper.toDto(entity);
    
    // Get financial information from n8n if lead number exists
    const leadNumber = entity.lead?.leadNumber;
    if (leadNumber) {
      try {
        const financial = await this.n8nService.getProjectFinancial(leadNumber);
        if (financial) {
          dto.financial = financial;
        }
      } catch (error: any) {
        this.logger.error(
          `Error fetching financial data from n8n for project ${id}: ${error.message}`,
        );
        // Continue without financial data rather than failing
      }
    }
    
    return dto;
  }

  async findByLeadNumber(leadNumber: string): Promise<any> {
    const entity = await this.projectsRepository.findByLeadNumber(leadNumber);
    if (!entity) {
      throw new ResourceNotFoundException(
        `Project not found with leadNumber: ${leadNumber}`,
      );
    }
    
    const dto = this.projectMapper.toDto(entity);
    
    // Get financial information from n8n
    try {
      const financial = await this.n8nService.getProjectFinancial(leadNumber);
      if (financial) {
        dto.financial = financial;
      }
    } catch (error: any) {
      this.logger.error(
        `Error fetching financial data from n8n for lead number ${leadNumber}: ${error.message}`,
      );
      // Continue without financial data rather than failing
    }
    
    return dto;
  }
}
