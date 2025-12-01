import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../../../entities/company.entity';
import { Contact } from '../../../entities/contact.entity';
import { CompaniesRepository } from '../repositories/companies.repository';
import { CompanyMapper } from '../mappers/company.mapper';
import { CreateCompanyDto } from '../dto/create-company.dto';
import { UpdateCompanyDto } from '../dto/update-company.dto';
import { ValidationException, ResourceNotFoundException } from '../../../common/exceptions';
import { BaseService } from '../../../common/services/base.service';

@Injectable()
export class CompaniesService extends BaseService<any, number, Company> {
  constructor(
    private readonly companiesRepository: CompaniesRepository,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    private readonly companyMapper: CompanyMapper,
  ) {
    super(companyRepo, companyMapper);
  }

  async create(dto: CreateCompanyDto): Promise<any> {
    await this.validate(dto, null);
    const entity = this.companyMapper.toEntity(dto);
    const saved = await this.companyRepo.save(entity);
    return this.companyMapper.toDto(saved);
  }

  async update(id: number, dto: UpdateCompanyDto): Promise<any> {
    const entity = await this.companyRepo.findOne({ where: { id } });
    if (!entity) {
      throw new ResourceNotFoundException(`Company not found with id: ${id}`);
    }
    await this.validate(dto, id);
    this.companyMapper.updateEntity(dto, entity);
    const saved = await this.companyRepo.save(entity);
    return this.companyMapper.toDto(saved);
  }

  private async validate(dto: CreateCompanyDto | UpdateCompanyDto, id: number | null): Promise<void> {
    if (dto.name) {
      const exists = await this.companiesRepository.existsByNameIgnoreCase(dto.name);
      
      if (id === null) {
        // Creating new company
        if (exists) {
          throw ValidationException.format('Company name already exists: %s', dto.name);
        }
      } else {
        // Updating existing company
        if (exists) {
          const existing = await this.companyRepo
            .createQueryBuilder('company')
            .where('LOWER(company.name) = LOWER(:name)', { name: dto.name })
            .getOne();
          
          if (existing && existing.id !== id) {
            throw ValidationException.format('Company name already exists: %s', dto.name);
          }
        }
      }
    }
  }

  async findCustomers(): Promise<any[]> {
    const entities = await this.companiesRepository.findByCustomerTrue();
    return entities.map((entity) => this.companyMapper.toDto(entity));
  }

  async findClients(): Promise<any[]> {
    const entities = await this.companiesRepository.findByClientTrue();
    return entities.map((entity) => this.companyMapper.toDto(entity));
  }

  async delete(id: number): Promise<void> {
    const company = await this.companyRepo.findOne({ 
      where: { id },
      relations: ['contacts']
    });
    
    if (!company) {
      throw new ResourceNotFoundException(`Company not found with id: ${id}`);
    }

    // Remove company reference from all associated contacts
    if (company.contacts && company.contacts.length > 0) {
      for (const contact of company.contacts) {
        contact.company = null as any;
        await this.contactRepo.save(contact);
      }
    }

    // Now delete the company
    await this.companyRepo.delete(id);
  }

  async assignContactsToCompany(companyId: number, contactIds: number[]): Promise<void> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new ResourceNotFoundException(`Company not found with id: ${companyId}`);
    }

    // Remove company from contacts that are no longer selected
    const currentContacts = await this.contactRepo.find({
      where: { company: { id: companyId } },
    });

    for (const contact of currentContacts) {
      if (!contactIds.includes(contact.id)) {
        contact.company = null as any;
        await this.contactRepo.save(contact);
      }
    }

    // Assign company to selected contacts
    for (const contactId of contactIds) {
      const contact = await this.contactRepo.findOne({ where: { id: contactId } });
      if (!contact) {
        throw new ResourceNotFoundException(`Contact not found with id: ${contactId}`);
      }
      contact.company = company;
      await this.contactRepo.save(contact);
    }
  }
}
