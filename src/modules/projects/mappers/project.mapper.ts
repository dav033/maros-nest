import { Injectable } from '@nestjs/common';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { Project } from '../../../entities/project.entity';

@Injectable()
export class ProjectMapper {
  toEntity(dto: CreateProjectDto): Project {
    const entity = new Project();
    entity.projectName = dto.projectName;
    entity.overview = dto.overview;
    entity.payments = dto.payments;
    entity.projectStatus = dto.projectStatus;
    entity.invoiceStatus = dto.invoiceStatus;
    entity.quickbooks = dto.quickbooks ?? false;
    
    if (dto.startDate) entity.startDate = new Date(dto.startDate);
    if (dto.endDate) entity.endDate = new Date(dto.endDate);
    
    return entity;
  }

  updateEntity(dto: UpdateProjectDto, entity: Project): void {
    if (dto.projectName !== undefined) entity.projectName = dto.projectName;
    if (dto.overview !== undefined) entity.overview = dto.overview;
    if (dto.payments !== undefined) entity.payments = dto.payments;
    if (dto.projectStatus !== undefined) entity.projectStatus = dto.projectStatus;
    if (dto.invoiceStatus !== undefined) entity.invoiceStatus = dto.invoiceStatus;
    if (dto.quickbooks !== undefined) entity.quickbooks = dto.quickbooks;
    
    if (dto.startDate !== undefined) entity.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) entity.endDate = new Date(dto.endDate);
  }

  toDto(entity: Project): any {
    // Helper to safely convert date to ISO string
    const formatDate = (date: Date | string | null | undefined): string | null => {
      if (!date) return null;
      if (typeof date === 'string') return date;
      if (date instanceof Date) return date.toISOString();
      return null;
    };

    return {
      id: entity.id,
      projectName: entity.projectName,
      overview: entity.overview,
      payments: entity.payments,
      projectStatus: entity.projectStatus,
      invoiceStatus: entity.invoiceStatus,
      quickbooks: entity.quickbooks,
      startDate: formatDate(entity.startDate),
      endDate: formatDate(entity.endDate),
      leadId: entity.lead ? entity.lead.id : undefined,
    };
  }
}
