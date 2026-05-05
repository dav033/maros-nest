import { Injectable } from '@nestjs/common';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { Project } from '../../../../entities/project.entity';

@Injectable()
export class ProjectMapper {
  toEntity(dto: CreateProjectDto): Project {
    const entity = new Project();
    entity.projectProgressStatus = dto.projectProgressStatus;
    entity.overview = dto.overview;
    entity.notes = dto.notes ?? [];
    
    return entity;
  }

  updateEntity(dto: UpdateProjectDto, entity: Project): void {
    if (dto.projectProgressStatus !== undefined) entity.projectProgressStatus = dto.projectProgressStatus;
    if (dto.overview !== undefined) entity.overview = dto.overview;
    if (dto.notes !== undefined) entity.notes = dto.notes;
  }

  toDto(entity: Project): any {
    const dto: any = {
      id: entity.id,
      projectProgressStatus: entity.projectProgressStatus,
      overview: entity.overview,
      notes: entity.notes || [],
      leadId: entity.lead ? entity.lead.id : undefined,
    };

    // Include lead information if loaded
    if (entity.lead) {
      dto.lead = {
        id: entity.lead.id,
        name: entity.lead.name,
        leadNumber: entity.lead.leadNumber,
        location: entity.lead.location,
        addressLink: entity.lead.addressLink,
        startDate: entity.lead.startDate,
        status: entity.lead.status,
        contact: entity.lead.contact ? {
          id: entity.lead.contact.id,
          name: entity.lead.contact.name,
          phone: entity.lead.contact.phone,
          email: entity.lead.contact.email,
        } : null,
        projectType: entity.lead.projectType ? {
          id: entity.lead.projectType.id,
          name: entity.lead.projectType.name,
          color: entity.lead.projectType.color,
        } : null,
        notes: entity.lead.notes || [],
      };
    }

    return dto;
  }
}
