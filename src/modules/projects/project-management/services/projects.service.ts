import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { Lead } from '../../../../entities/lead.entity';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectMapper } from '../mappers/project.mapper';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import {
  ValidationException,
  ResourceNotFoundException,
} from '../../../../common/exceptions';
import { BaseService } from '../../../../common/services/base.service';
import { N8nService } from '../../../n8n/services/n8n.service';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';

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
    const startTime = Date.now();

    const entities = await this.projectRepo.find({
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });

    const dtos = entities.map((entity) => this.projectMapper.toDto(entity));

    const projectNumbers = entities
      .map((entity) => entity.lead?.leadNumber)
      .filter((number): number is string => !!number);

    if (projectNumbers.length > 0) {
      try {
        const financials = await this.n8nService.getProjectFinancials(projectNumbers);
        const financialMap = new Map(financials.map((f) => [f.projectNumber, f]));

        dtos.forEach((dto, i) => {
          const leadNumber = entities[i].lead?.leadNumber;
          if (leadNumber) {
            dto.financial = financialMap.get(leadNumber) ?? null;
          }
        });

        this.logger.log(`Retrieved financial data for ${financials.length} projects from n8n`);
      } catch (error: any) {
        this.logger.error(`Error fetching financial data from n8n: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Projects findAll completed in ${duration}ms`);

    return dtos;
  }

  async findById(id: number): Promise<any> {
    const startTime = Date.now();
    
    const entity = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }
    
    const dto = this.projectMapper.toDto(entity);

    const leadNumber = entity.lead?.leadNumber;
    if (leadNumber) {
      try {
        const financial = await this.n8nService.getProjectFinancial(leadNumber);
        dto.financial = financial ?? null;
        this.logger.log(`Retrieved financial data from n8n for project ${id}`);
      } catch (error: any) {
        this.logger.error(`Error fetching financial data from n8n for project ${id}: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Project ${id} findById completed in ${duration}ms`);

    return dto;
  }

  async getProjectDetails(id: number): Promise<any> {
    const project = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead', 'lead.contact', 'lead.contact.company', 'lead.projectType'],
    });

    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    const projectDto = this.projectMapper.toDto(project);

    // Map lead with contact information
    const leadDto = project.lead ? {
      id: project.lead.id,
      leadNumber: project.lead.leadNumber,
      name: project.lead.name,
      startDate: project.lead.startDate,
      location: project.lead.location,
      addressLink: project.lead.addressLink,
      status: project.lead.status,
      notes: project.lead.notes,
      inReview: project.lead.inReview,
      contact: project.lead.contact ? {
        id: project.lead.contact.id,
        name: project.lead.contact.name,
        phone: project.lead.contact.phone,
        email: project.lead.contact.email,
        occupation: project.lead.contact.occupation,
        address: project.lead.contact.address,
        addressLink: project.lead.contact.addressLink,
        isCustomer: project.lead.contact.customer,
        isClient: project.lead.contact.client,
        company: project.lead.contact.company ? {
          id: project.lead.contact.company.id,
          name: project.lead.contact.company.name,
          address: project.lead.contact.company.address,
          type: project.lead.contact.company.type,
          serviceId: project.lead.contact.company.serviceId,
          isCustomer: project.lead.contact.company.customer,
          isClient: project.lead.contact.company.client,
        } : null,
      } : null,
      projectType: project.lead.projectType ? {
        id: project.lead.projectType.id,
        name: project.lead.projectType.name,
      } : null,
    } : null;

    return {
      ...projectDto,
      lead: leadDto,
    };
  }

  async findByStatus(status: ProjectProgressStatus): Promise<any[]> {
    const entities = await this.projectRepo.find({
      where: { projectProgressStatus: status },
      relations: ['lead', 'lead.contact', 'lead.contact.company', 'lead.projectType'],
    });
    return entities.map((entity) => this.projectMapper.toDto(entity));
  }

  async findByContactId(contactId: number): Promise<any[]> {
    const entities = await this.projectRepo
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.lead', 'lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .where('contact.id = :contactId', { contactId })
      .getMany();
    return entities.map((entity) => this.projectMapper.toDto(entity));
  }

  async findByLeadNumber(leadNumber: string): Promise<any> {
    const startTime = Date.now();
    
    const entity = await this.projectsRepository.findByLeadNumber(leadNumber);
    if (!entity) {
      throw new ResourceNotFoundException(
        `Project not found with leadNumber: ${leadNumber}`,
      );
    }
    
    const dto = this.projectMapper.toDto(entity);

    try {
      const financial = await this.n8nService.getProjectFinancial(leadNumber);
      dto.financial = financial ?? null;
      this.logger.log(`Retrieved financial data from n8n for lead number ${leadNumber}`);
    } catch (error: any) {
      this.logger.error(`Error fetching financial data from n8n for lead number ${leadNumber}: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Project findByLeadNumber ${leadNumber} completed in ${duration}ms`);

    return dto;
  }

  async delete(id: number): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id }, select: ['id'] });
    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }
    await this.projectRepo.delete(id);
    this.logger.log(`Project ${id} deleted`);
  }
}
