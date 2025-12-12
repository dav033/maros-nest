import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from '../dto/create-company.dto';
import { UpdateCompanyDto } from '../dto/update-company.dto';
import { Company } from '../../../entities/company.entity';

@Injectable()
export class CompanyMapper {
  toEntity(dto: CreateCompanyDto): Company {
    const entity = new Company();
    entity.name = dto.name;
    entity.address = dto.address;
    entity.addressLink = dto.addressLink;
    entity.type = dto.type;
    entity.serviceId = dto.serviceId;
    entity.customer = dto.isCustomer ?? false;
    entity.client = dto.isClient ?? false;
    entity.notes = dto.notes;
    entity.phone = dto.phone;
    entity.email = dto.email;
    entity.submiz = dto.submiz;
    return entity;
  }

  updateEntity(dto: UpdateCompanyDto, entity: Company): void {
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.addressLink !== undefined) entity.addressLink = dto.addressLink;
    if (dto.type !== undefined) entity.type = dto.type;
    if (dto.serviceId !== undefined) entity.serviceId = dto.serviceId;
    if (dto.isCustomer !== undefined) entity.customer = dto.isCustomer;
    if (dto.isClient !== undefined) entity.client = dto.isClient;
    
    // Manual handling of notes as per original Java mapper
    if (dto.notes !== undefined) {
      entity.notes = dto.notes;
    }
    
    if (dto.phone !== undefined) entity.phone = dto.phone;
    if (dto.email !== undefined) entity.email = dto.email;
    if (dto.submiz !== undefined) entity.submiz = dto.submiz;
  }

  toDto(entity: Company): any {
    // Return a plain object or a specific ResponseDto if created
    return {
      id: entity.id,
      name: entity.name,
      address: entity.address,
      addressLink: entity.addressLink,
      type: entity.type,
      serviceId: entity.serviceId,
      isCustomer: entity.customer,
      isClient: entity.client,
      notes: entity.notes,
      phone: entity.phone,
      email: entity.email,
      submiz: entity.submiz,
    };
  }
}
