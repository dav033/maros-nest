import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../entities/project.entity';
import { ProjectsRepository } from '../repositories/projects.repository';

export interface ProjectWithLeadDto {
  id: number;
  projectName: string;
  overview?: string;
  payments?: string;
  projectStatus: string;
  invoiceStatus?: string;
  quickbooks?: string;
  startDate?: Date;
  endDate?: Date;
  leadId?: number;
  leadName?: string;
  leadNumber?: string;
  location?: string;
  contactName?: string;
  customerName?: string;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly projectsRepository: ProjectsRepository,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  async getProjectsWithLead(): Promise<ProjectWithLeadDto[]> {
    const projects = await this.projectsRepository.findProjectsWithLeadAndContact();
    return projects.map((project) => this.convertToDtoWithLead(project));
  }

  private convertToDtoWithLead(entity: Project): ProjectWithLeadDto {
    const dto: ProjectWithLeadDto = {
      id: entity.id,
      projectName: entity.projectName,
      overview: entity.overview,
      payments: Array.isArray(entity.payments) ? entity.payments.join(', ') : entity.payments,
      projectStatus: entity.projectStatus || '',
      invoiceStatus: entity.invoiceStatus,
      quickbooks: typeof entity.quickbooks === 'boolean' ? (entity.quickbooks ? 'true' : 'false') : entity.quickbooks,
      startDate: entity.startDate,
      endDate: entity.endDate,
    };

    const lead = entity.lead;
    if (lead) {
      dto.leadId = lead.id;
      dto.leadName = lead.name;
      dto.leadNumber = lead.leadNumber;

      let location: string | undefined;
      try {
        location = lead.location;
      } catch (error) {
        // Ignore if location is not loaded
      }
      if (!location || location.trim() === '') {
        location = lead.name;
      }
      dto.location = location;

      try {
        const contact = lead.contact;
        if (contact) {
          dto.contactName = contact.name;
          dto.customerName = contact.name;
        }
      } catch (error) {
        this.logger.debug(`Contact not loaded for lead ${lead.id}`);
      }
    }

    return dto;
  }
}
