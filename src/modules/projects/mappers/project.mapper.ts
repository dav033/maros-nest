import { Injectable } from '@nestjs/common';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { Project } from '../../../entities/project.entity';

@Injectable()
export class ProjectMapper {
  toEntity(dto: CreateProjectDto): Project {
    const entity = new Project();
    entity.invoiceAmount = dto.invoiceAmount;
    entity.payments = dto.payments;
    entity.projectProgressStatus = dto.projectProgressStatus;
    entity.invoiceStatus = dto.invoiceStatus;
    entity.quickbooks = dto.quickbooks ?? false;
    entity.overview = dto.overview;
    entity.notes = dto.notes ?? [];
    
    return entity;
  }

  updateEntity(dto: UpdateProjectDto, entity: Project): void {
    if (dto.invoiceAmount !== undefined) entity.invoiceAmount = dto.invoiceAmount;
    if (dto.payments !== undefined) entity.payments = dto.payments;
    if (dto.projectProgressStatus !== undefined) entity.projectProgressStatus = dto.projectProgressStatus;
    if (dto.invoiceStatus !== undefined) entity.invoiceStatus = dto.invoiceStatus;
    if (dto.quickbooks !== undefined) entity.quickbooks = dto.quickbooks;
    if (dto.overview !== undefined) entity.overview = dto.overview;
    if (dto.notes !== undefined) entity.notes = dto.notes;
  }

  toDto(entity: Project): any {
    // Convert invoiceAmount from decimal (string) to number if needed
    let invoiceAmount: number | undefined = undefined;
    if (entity.invoiceAmount !== null && entity.invoiceAmount !== undefined) {
      if (typeof entity.invoiceAmount === 'number') {
        invoiceAmount = entity.invoiceAmount;
      } else if (typeof entity.invoiceAmount === 'string') {
        const parsed = parseFloat(entity.invoiceAmount);
        invoiceAmount = isNaN(parsed) ? undefined : parsed;
      }
    }
    
    const dto: any = {
      id: entity.id,
      invoiceAmount: invoiceAmount,
      payments: entity.payments,
      projectProgressStatus: entity.projectProgressStatus,
      invoiceStatus: entity.invoiceStatus,
      quickbooks: entity.quickbooks,
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
