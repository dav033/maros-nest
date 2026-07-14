import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Contact } from '../../../../entities/contact.entity';
import { Company } from '../../../../entities/company.entity';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { ContactsRepository } from '../repositories/contacts.repository';
import { ContactMapper } from '../mappers/contact.mapper';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';
import {
  ValidationException,
  ContactExceptions,
  ResourceNotFoundException,
} from '../../../../common/exceptions';
import { BaseService } from '../../../../common/services/base.service';

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
    private readonly dataSource: DataSource,
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

  /**
   * Crea un contacto. Si se pasa un `EntityManager` (p. ej. desde una
   * transacción en otro servicio), todas las lecturas y la escritura usan ese
   * contexto, de modo que la operación participa de la transacción y puede
   * revertirse atómicamente.
   */
  async create(dto: CreateContactDto, manager?: EntityManager): Promise<any> {
    const contactRepo = manager
      ? manager.getRepository(Contact)
      : this.contactRepo;
    const companyRepo = manager
      ? manager.getRepository(Company)
      : this.companyRepo;

    // Regla de duplicados: un contacto SÍ puede compartir teléfono y/o email
    // con su empresa u otro contacto (p. ej. el dueño de una pequeña empresa).
    // Solo se bloquea el duplicado real: misma persona = mismo nombre + email +
    // teléfono a la vez. Si falta alguno de los tres, se permite guardar.
    if (
      dto.name?.trim() &&
      dto.email?.trim() &&
      dto.phone?.trim()
    ) {
      const identical = await contactRepo
        .createQueryBuilder('contact')
        .where('LOWER(contact.name) = LOWER(:name)', { name: dto.name })
        .andWhere('LOWER(contact.email) = LOWER(:email)', { email: dto.email })
        .andWhere('contact.phone = :phone', { phone: dto.phone })
        .getOne();
      if (identical) {
        throw ValidationException.format(
          'Ya existe un contacto idéntico (mismo nombre, email y teléfono): %s',
          dto.name,
        );
      }
    }

    const entity = this.contactMapper.toEntity(dto);

    // Relación con empresa
    if (dto.companyId) {
      const company = await companyRepo.findOne({
        where: { id: dto.companyId },
      });
      if (!company) {
        throw ValidationException.format(
          'No existe una empresa con id: %s',
          dto.companyId.toString(),
        );
      }
      entity.company = company;
    }

    const saved = await contactRepo.save(entity);
    return this.contactMapper.toDto(saved);
  }

  async update(id: number, dto: UpdateContactDto): Promise<any> {
    const startTime = Date.now();

    // Optimización: Solo cargar relaciones si se está actualizando companyId
    const needsCompanyRelation = dto.companyId !== undefined;
    const entity = await this.contactRepo.findOne({
      where: { id },
      relations: needsCompanyRelation ? ['company'] : []
    });

    if (!entity) {
      throw new ResourceNotFoundException(`Contact not found with id: ${id}`);
    }

    // Regla de duplicados (igual que en create): se permite compartir teléfono
    // y/o email con la empresa u otro contacto. Solo se bloquea el duplicado
    // real: misma persona = mismo nombre + email + teléfono a la vez. Como el
    // DTO puede ser parcial, se combinan los campos entrantes con los actuales.
    const effectiveName = (dto.name ?? entity.name ?? '').trim();
    const effectiveEmail = (dto.email ?? entity.email ?? '').trim();
    const effectivePhone = (dto.phone ?? entity.phone ?? '').trim();
    if (effectiveName && effectiveEmail && effectivePhone) {
      const identical = await this.contactsRepository.findIdenticalContactExcludingId(
        effectiveName,
        effectiveEmail,
        effectivePhone,
        id,
      );
      if (identical) {
        throw ValidationException.format(
          'Ya existe un contacto idéntico (mismo nombre, email y teléfono): %s',
          effectiveName,
        );
      }
    }

    this.contactMapper.updateEntity(dto, entity);

    // Handle company relationship
    if (dto.companyId !== undefined) {
      if (dto.companyId) {
        const company = await this.companyRepo.findOne({ where: { id: dto.companyId } });
        if (!company) {
          throw ValidationException.format('No existe una empresa con id: %s', dto.companyId.toString());
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
    const entity = await this.contactsRepository.findByNameIgnoreCase(name);
    if (!entity) {
      throw new ContactExceptions.ContactNotFoundException(name);
    }
    return this.contactMapper.toDto(entity);
  }

  async getContactByEmail(email: string): Promise<any> {
    const entity = await this.contactsRepository.findByEmailIgnoreCase(email);
    if (!entity) {
      throw new ContactExceptions.ContactNotFoundException(email);
    }
    return this.contactMapper.toDto(entity);
  }

  async getContactByPhone(phone: string): Promise<any> {
    const entity = await this.contactsRepository.findByPhoneExact(phone);
    if (!entity) {
      throw new ContactExceptions.ContactNotFoundException(phone);
    }
    return this.contactMapper.toDto(entity);
  }

  async searchContacts(query: string): Promise<any[]> {
    const entities = await this.contactsRepository.searchByQuery(query);
    return entities.map((entity) => this.contactMapper.toDto(entity));
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
    // La regla de duplicados ya no bloquea email/teléfono por separado: un
    // contacto puede compartirlos con su empresa u otro contacto. Solo hay
    // conflicto cuando coinciden nombre + email + teléfono (misma persona).
    let duplicate = false;
    if (name?.trim() && email?.trim() && phone?.trim()) {
      const identical = excludeId
        ? await this.contactsRepository.findIdenticalContactExcludingId(
            name,
            email,
            phone,
            excludeId,
          )
        : await this.contactsRepository.findIdenticalContact(name, email, phone);
      duplicate = !!identical;
    }

    const reason = duplicate
      ? 'Duplicate contact (same name, email and phone)'
      : 'OK';

    return {
      nameAvailable: !duplicate,
      emailAvailable: !duplicate,
      phoneAvailable: !duplicate,
      nameReason: reason,
      emailReason: reason,
      phoneReason: reason,
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
      projectProgressStatus: project.projectProgressStatus,
      quickbooks: project.quickbooks,
      overview: project.overview,
      notes: project.notes,
    };
  }

  async delete(id: number): Promise<void> {
    const contact = await this.contactRepo.findOne({ where: { id }, select: ['id'] });
    if (!contact) {
      throw new ContactExceptions.ContactNotFoundException(id);
    }

    await this.dataSource.query(
      'UPDATE leads SET contact_id = NULL WHERE contact_id = $1',
      [id],
    );

    await this.contactRepo.delete(id);
    this.logger.log(`Contact ${id} deleted`);
  }
}
