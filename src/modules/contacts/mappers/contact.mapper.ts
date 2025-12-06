import { Injectable } from '@nestjs/common';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';
import { Contact } from '../../../entities/contact.entity';

@Injectable()
export class ContactMapper {
  toEntity(dto: CreateContactDto): Contact {
    const entity = new Contact();
    entity.name = dto.name;
    // Map role or occupation to occupation field
    entity.occupation = dto.occupation ?? dto.role;
    entity.phone = dto.phone;
    entity.email = dto.email;
    entity.address = dto.address;
    entity.addressLink = dto.addressLink;
    entity.customer = dto.isCustomer ?? false;
    entity.client = dto.isClient ?? false;
    entity.notes = dto.notes;
    
    // Company relationship is handled by service usually, 
    // but we can set the ID if we want to use relationId loading or similar
    // For now, we just map basic fields.
    
    return entity;
  }

  updateEntity(dto: UpdateContactDto, entity: Contact): void {
    if (dto.name !== undefined) entity.name = dto.name;
    
    // Map role update to occupation
    if (dto.role !== undefined) entity.occupation = dto.role;
    // If occupation is explicitly provided, it overrides role
    if (dto.occupation !== undefined) entity.occupation = dto.occupation;
    
    if (dto.phone !== undefined) entity.phone = dto.phone;
    if (dto.email !== undefined) entity.email = dto.email;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.addressLink !== undefined) entity.addressLink = dto.addressLink;
    if (dto.isCustomer !== undefined) entity.customer = dto.isCustomer;
    if (dto.isClient !== undefined) entity.client = dto.isClient;
    if (dto.notes !== undefined) entity.notes = dto.notes;
  }

  toDto(entity: Contact): any {
    const companyDto = entity.company ? {
      id: entity.company.id,
      name: entity.company.name,
      address: entity.company.address,
      type: entity.company.type,
      serviceId: entity.company.serviceId,
      isCustomer: entity.company.customer,
      isClient: entity.company.client,
      notes: Array.isArray(entity.company.notes) ? entity.company.notes : [],
    } : null;
    
    return {
      id: entity.id,
      name: entity.name,
      role: entity.occupation,
      occupation: entity.occupation,
      phone: entity.phone,
      email: entity.email,
      address: entity.address,
      addressLink: entity.addressLink,
      isCustomer: entity.customer,
      isClient: entity.client,
      company: companyDto,
      notes: entity.notes,
    };
  }
}
