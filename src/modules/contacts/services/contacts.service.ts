import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../../entities/contact.entity';
import { Company } from '../../../entities/company.entity';
import { Lead } from '../../../entities/lead.entity';
import { Project } from '../../../entities/project.entity';
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
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly contactsRepository: ContactsRepository,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly contactMapper: ContactMapper,
  ) {
    super(contactRepo, contactMapper);
  }

  async findAll(): Promise<any[]> {
    const entities = await this.contactRepo.find({ relations: ['company'] });
    return entities.map((entity) => this.contactMapper.toDto(entity));
  }

  async findByCompany(companyId: number): Promise<any[]> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new ResourceNotFoundException(`Company not found with id: ${companyId}`);
    }

    const entities = await this.contactRepo.find({
      where: { company: { id: companyId } },
      relations: ['company'],
    });

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
    const startTime = Date.now();
    
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

    // Optimización: Solo cargar relaciones si se está actualizando companyId
    const needsCompanyRelation = dto.companyId !== undefined;
    const entity = await this.contactRepo.findOne({ 
      where: { id }, 
      relations: needsCompanyRelation ? ['company'] : []
    });
    
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
    const duration = Date.now() - startTime;
    this.logger.log(`Contact ${id} updated in ${duration}ms`);
    
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

  async getContactDetails(id: number): Promise<any> {
    const contact = await this.contactRepo.findOne({
      where: { id },
      relations: ['company'],
    });

    if (!contact) {
      throw new ContactExceptions.ContactNotFoundException(id);
    }

    // Get all leads for this contact with their project types
    const leads = await this.leadRepo.find({
      where: { contact: { id } },
      relations: ['projectType', 'project'],
      order: { id: 'DESC' },
    });

    // Get all projects associated with these leads
    const leadIds = leads.map((lead) => lead.id);
    const projects = leadIds.length > 0
      ? await this.projectRepo
          .createQueryBuilder('project')
          .leftJoinAndSelect('project.lead', 'lead')
          .leftJoinAndSelect('lead.projectType', 'projectType')
          .where('lead.id IN (:...leadIds)', { leadIds })
          .getMany()
      : [];

    // Map leads with their projects
    const leadsWithProjects = leads.map((lead) => {
      const project = projects.find((p) => p.lead.id === lead.id);
      return {
        ...this.mapLeadToDto(lead),
        project: project ? this.mapProjectToDto(project) : null,
      };
    });

    const contactDto = this.contactMapper.toDto(contact);

    return {
      ...contactDto,
      leads: leadsWithProjects,
      stats: {
        totalLeads: leads.length,
        totalProjects: projects.length,
        activeProjects: projects.filter((p) => 
          p.projectProgressStatus === 'IN_PROGRESS' || 
          p.projectProgressStatus === 'PERMITS'
        ).length,
        completedProjects: projects.filter((p) => 
          p.projectProgressStatus === 'COMPLETED'
        ).length,
      },
    };
  }

  private mapLeadToDto(lead: Lead): any {
    return {
      id: lead.id,
      leadNumber: lead.leadNumber,
      name: lead.name,
      startDate: lead.startDate,
      location: lead.location,
      addressLink: lead.addressLink,
      status: lead.status,
      notes: lead.notes,
      inReview: lead.inReview,
      projectType: lead.projectType ? {
        id: lead.projectType.id,
        name: lead.projectType.name,
      } : null,
    };
  }

  private mapProjectToDto(project: Project): any {
    return {
      id: project.id,
      invoiceAmount: project.invoiceAmount ? parseFloat(project.invoiceAmount.toString()) : null,
      payments: project.payments,
      projectProgressStatus: project.projectProgressStatus,
      invoiceStatus: project.invoiceStatus,
      quickbooks: project.quickbooks,
      overview: project.overview,
      notes: project.notes,
    };
  }
}
