import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../../entities/contact.entity';
import { Company } from '../../../entities/company.entity';
import { ContactsRepository } from '../repositories/contacts.repository';
import { ContactMapper } from '../mappers/contact.mapper';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';
import { ValidationException, ContactExceptions, ResourceNotFoundException } from '../../../common/exceptions';
import { BaseService } from '../../../common/services/base.service';

export interface ContactValidationResponse {
  nameAvailable: boolean;
  emailAvailable: boolean;
  phoneAvailable: boolean;
  nameReason: string;
  emailReason: string;
  phoneReason: string;
}

@Injectable()
export class ContactsService extends BaseService<any, number, Contact> {
  constructor(
    private readonly contactsRepository: ContactsRepository,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly contactMapper: ContactMapper,
  ) {
    super(contactRepo, contactMapper);
  }

  async findAll(): Promise<any[]> {
    const entities = await this.contactRepo.find({ relations: ['company'] });
    return entities.map((entity) => this.contactMapper.toDto(entity));
  }

  async create(dto: CreateContactDto): Promise<any> {
    // Validate name
    if (dto.name && await this.contactsRepository.existsByNameIgnoreCase(dto.name)) {
      throw ValidationException.format('Contact name already exists: %s', dto.name);
    }

    // Validate email
    if (dto.email && dto.email.trim() !== '' && await this.contactsRepository.existsByEmailIgnoreCase(dto.email)) {
      throw ValidationException.format('Contact email already exists: %s', dto.email);
    }

    // Validate phone
    if (dto.phone && dto.phone.trim() !== '' && await this.contactsRepository.existsByPhone(dto.phone)) {
      throw ValidationException.format('Contact phone already exists: %s', dto.phone);
    }

    const entity = this.contactMapper.toEntity(dto);

    // Handle company relationship
    if (dto.companyId) {
      const company = await this.companyRepo.findOne({ where: { id: dto.companyId } });
      if (!company) {
        throw ValidationException.format('Company not found with id: %s', dto.companyId.toString());
      }
      entity.company = company;
    }

    const saved = await this.contactRepo.save(entity);
    return this.contactMapper.toDto(saved);
  }

  async update(id: number, dto: UpdateContactDto): Promise<any> {
    // Validate name
    if (dto.name && await this.contactsRepository.existsByNameIgnoreCaseAndIdNot(dto.name, id)) {
      throw ValidationException.format('Contact name already exists: %s', dto.name);
    }

    // Validate email
    if (dto.email && dto.email.trim() !== '' && await this.contactsRepository.existsByEmailIgnoreCaseAndIdNot(dto.email, id)) {
      throw ValidationException.format('Contact email already exists: %s', dto.email);
    }

    // Validate phone
    if (dto.phone && dto.phone.trim() !== '' && await this.contactsRepository.existsByPhoneAndIdNot(dto.phone, id)) {
      throw ValidationException.format('Contact phone already exists: %s', dto.phone);
    }

    const entity = await this.contactRepo.findOne({ where: { id }, relations: ['company'] });
    if (!entity) {
      throw new ResourceNotFoundException(`Contact not found with id: ${id}`);
    }

    this.contactMapper.updateEntity(dto, entity);

    // Handle company relationship
    if (dto.companyId !== undefined) {
      if (dto.companyId) {
        const company = await this.companyRepo.findOne({ where: { id: dto.companyId } });
        if (!company) {
          throw ValidationException.format('Company not found with id: %s', dto.companyId.toString());
        }
        entity.company = company;
      } else {
        entity.company = null as any;
      }
    }

    const saved = await this.contactRepo.save(entity);
    return this.contactMapper.toDto(saved);
  }

  async getContactByName(name: string): Promise<any> {
    const entity = await this.contactsRepository.findByName(name);
    if (!entity) {
      throw new ContactExceptions.ContactNotFoundException(name);
    }
    return this.contactMapper.toDto(entity);
  }

  async getContactById(id: number): Promise<any> {
    const entity = await this.contactRepo.findOne({ where: { id }, relations: ['company'] });
    if (!entity) {
      throw new ContactExceptions.ContactNotFoundException(id);
    }
    return this.contactMapper.toDto(entity);
  }

  async validateAvailability(
    name?: string,
    email?: string,
    phone?: string,
    excludeId?: number,
  ): Promise<ContactValidationResponse> {
    let nameOk = true;
    let emailOk = true;
    let phoneOk = true;
    let nameReason = 'OK';
    let emailReason = 'OK';
    let phoneReason = 'OK';

    if (name && name.trim() !== '') {
      nameOk = excludeId
        ? !(await this.contactsRepository.existsByNameIgnoreCaseAndIdNot(name, excludeId))
        : !(await this.contactsRepository.existsByNameIgnoreCase(name));
      if (!nameOk) nameReason = 'Name already exists';
    }

    if (email && email.trim() !== '') {
      emailOk = excludeId
        ? !(await this.contactsRepository.existsByEmailIgnoreCaseAndIdNot(email, excludeId))
        : !(await this.contactsRepository.existsByEmailIgnoreCase(email));
      if (!emailOk) emailReason = 'Email already exists';
    }

    if (phone && phone.trim() !== '') {
      phoneOk = excludeId
        ? !(await this.contactsRepository.existsByPhoneAndIdNot(phone, excludeId))
        : !(await this.contactsRepository.existsByPhone(phone));
      if (!phoneOk) phoneReason = 'Phone already exists';
    }

    return {
      nameAvailable: nameOk,
      emailAvailable: emailOk,
      phoneAvailable: phoneOk,
      nameReason,
      emailReason,
      phoneReason,
    };
  }

  async findCustomers(): Promise<any[]> {
    const entities = await this.contactsRepository.findByCustomerTrue();
    return entities.map((entity) => this.contactMapper.toDto(entity));
  }

  async findClients(): Promise<any[]> {
    const entities = await this.contactsRepository.findByClientTrue();
    return entities.map((entity) => this.contactMapper.toDto(entity));
  }
}
