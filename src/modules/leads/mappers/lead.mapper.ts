import { Injectable } from '@nestjs/common';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { Lead } from '../../../entities/lead.entity';

@Injectable()
export class LeadMapper {
  toEntity(dto: CreateLeadDto): Lead {
    const entity = new Lead();
    // leadNumber and name are set by service after applyDefaults
    if (dto.leadNumber) entity.leadNumber = dto.leadNumber;
    entity.name = dto.name || ''; // name is required by entity, service ensures it's set
    // Convert string date to Date object
    entity.startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    if (dto.location) entity.location = dto.location;
    if (dto.addressLink) entity.addressLink = dto.addressLink;
    if (dto.status) entity.status = dto.status;
    if (dto.leadType) entity.leadType = dto.leadType;
    if (dto.notes) entity.notes = dto.notes;
    
    // Relations (contact, projectType) are usually handled by the service
    // finding the related entities and setting them.
    
    return entity;
  }

  updateEntity(dto: UpdateLeadDto, entity: Lead): void {
    if (dto.leadNumber !== undefined) entity.leadNumber = dto.leadNumber;
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.startDate !== undefined) entity.startDate = new Date(dto.startDate);
    if (dto.location !== undefined) entity.location = dto.location;
    if (dto.addressLink !== undefined) entity.addressLink = dto.addressLink;
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.leadType !== undefined) entity.leadType = dto.leadType;
    if (dto.notes !== undefined) entity.notes = dto.notes;
  }

  toDto(entity: Lead): any {
    // Helper to safely convert date to ISO string
    const formatDate = (date: Date | string | null | undefined): string | null => {
      if (!date) return null;
      if (typeof date === 'string') return date.split('T')[0];
      if (date instanceof Date) return date.toISOString().split('T')[0];
      return null;
    };

    // Parse notes if it's a string (JSONB sometimes comes as string)
    let notes = entity.notes;
    console.log('[BACKEND LEAD MAPPER] entity.notes raw:', entity.notes, 'type:', typeof entity.notes);
    if (typeof notes === 'string') {
      try {
        notes = JSON.parse(notes);
      } catch (e) {
        notes = [];
      }
    }
    notes = Array.isArray(notes) ? notes : [];
    console.log('[BACKEND LEAD MAPPER] notes final:', notes);

    return {
      id: entity.id,
      leadNumber: entity.leadNumber,
      name: entity.name,
      startDate: formatDate(entity.startDate),
      location: entity.location,
      addressLink: entity.addressLink,
      status: entity.status,
      leadType: entity.leadType,
      notes: notes,
      contact: entity.contact ? {
        id: entity.contact.id,
        name: entity.contact.name,
        phone: entity.contact.phone,
        email: entity.contact.email,
        occupation: entity.contact.occupation,
        address: entity.contact.address,
        isCustomer: entity.contact.customer,
        isClient: entity.contact.client,
      } : null,
      projectType: entity.projectType ? {
        id: entity.projectType.id,
        name: entity.projectType.name,
        color: entity.projectType.color,
      } : null,
    };
  }
}
