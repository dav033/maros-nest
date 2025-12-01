import { Injectable } from '@nestjs/common';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';
import { Contact } from '../../../entities/contact.entity';

@Injectable()
export class ContactMapper {
  toEntity(dto: CreateContactDto): Contact {
    const entity = new Contact();
    entity.name = dto.name;
    entity.occupation = dto.occupation;
    entity.phone = dto.phone;
    entity.email = dto.email;
    entity.address = dto.address;
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
    if (dto.occupation !== undefined) entity.occupation = dto.occupation;
    if (dto.phone !== undefined) entity.phone = dto.phone;
    if (dto.email !== undefined) entity.email = dto.email;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.isCustomer !== undefined) entity.customer = dto.isCustomer;
    if (dto.isClient !== undefined) entity.client = dto.isClient;
    if (dto.notes !== undefined) entity.notes = dto.notes;
  }

  toDto(entity: Contact): any {
    return {
      id: entity.id,
      name: entity.name,
      occupation: entity.occupation,
      phone: entity.phone,
      email: entity.email,
      address: entity.address,
      isCustomer: entity.customer,
      isClient: entity.client,
      companyId: entity.company ? entity.company.id : undefined, // Assuming company is loaded
      notes: entity.notes,
    };
  }
}
