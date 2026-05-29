import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
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
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import { ProjectQboEnrichmentService } from '../../../quickbooks/services/crm-bridge/project-qbo-enrichment.service';

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
    private readonly qboEnrichment: ProjectQboEnrichmentService,
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

    if (dto.leadName !== undefined) {
      const trimmedLeadName = this.normalizeLeadName(dto.leadName);
      if (!trimmedLeadName) {
        throw ValidationException.format('Lead name cannot be empty');
      }
      entity.lead.name = trimmedLeadName;
    }

    if (dto.leadNumber !== undefined) {
      const trimmedLeadNumber = this.normalizeLeadNumber(dto.leadNumber);
      if (!trimmedLeadNumber) {
        throw ValidationException.format('Lead number cannot be empty');
      }

      const existingLeadWithNumber = await this.leadRepo.count({
        where: {
          leadNumber: trimmedLeadNumber,
          id: Not(entity.lead.id),
        },
      });

      if (existingLeadWithNumber > 0) {
        throw ValidationException.format(
          'Lead number already exists: %s',
          trimmedLeadNumber,
        );
      }

      entity.lead.leadNumber = trimmedLeadNumber;
    }

    this.projectMapper.updateEntity(dto, entity);
    const saved = await this.projectRepo.save(entity);
    return this.projectMapper.toDto(saved);
  }

  private normalizeLeadName(value: string): string {
    return value.trim();
  }

  private normalizeLeadNumber(value: string): string {
    return value.trim();
  }

  async findAll(): Promise<any[]> {
    const startTime = Date.now();

    const entities = await this.projectRepo.find({
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });

    const dtos = entities.map((entity) => this.projectMapper.toDto(entity));
    await this.qboEnrichment.enrichProjectsSummary(dtos);

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
    await this.qboEnrichment.enrichProjectSummary(dto);

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

    const dto = {
      ...projectDto,
      lead: leadDto,
    };

    await this.qboEnrichment.enrichProjectFullProfile(dto);

    return dto;
  }

  async findByStatus(status: ProjectProgressStatus): Promise<any[]> {
    const entities = await this.projectRepo.find({
      where: { projectProgressStatus: status },
      relations: ['lead', 'lead.contact', 'lead.contact.company', 'lead.projectType'],
    });
    return entities.map((entity) => this.projectMapper.toDto(entity));
  }

  async getStatusCounts(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; count: number }>> {
    return this.projectsRepository.getStatusCounts(leadType);
  }

  async findAnalyticsProjectSeed(
    limit: number = 200,
    leadType?: LeadType,
  ): Promise<
    Array<{
      id: number;
      projectProgressStatus?: ProjectProgressStatus;
      leadNumber?: string;
      leadName?: string;
    }>
  > {
    return this.projectsRepository.findAnalyticsProjectSeed(limit, leadType);
  }

  async countAll(leadType?: LeadType): Promise<number> {
    return this.projectsRepository.countAll(leadType);
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
    await this.qboEnrichment.enrichProjectSummary(dto);

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
