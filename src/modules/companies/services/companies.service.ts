import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Company } from '../../../entities/company.entity';
import { Contact } from '../../../entities/contact.entity';
import { CompaniesRepository } from '../repositories/companies.repository';
import { CompanyMapper } from '../mappers/company.mapper';
import { CreateCompanyDto } from '../dto/create-company.dto';
import { UpdateCompanyDto } from '../dto/update-company.dto';
import { ValidationException, ResourceNotFoundException } from '../../../common/exceptions';
import { BaseService } from '../../../common/services/base.service';
import { executeInBackground } from '../../../common/utils/background-tasks.util';

@Injectable()
export class CompaniesService extends BaseService<any, number, Company> {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly companiesRepository: CompaniesRepository,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    private readonly companyMapper: CompanyMapper,
    private readonly dataSource: DataSource,
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
    const startTime = Date.now();
    
    // Verificar existencia sin cargar relaciones
    const company = await this.companyRepo.findOne({ 
      where: { id },
      select: ['id']
    });
    
    if (!company) {
      throw new ResourceNotFoundException(`Company not found with id: ${id}`);
    }

    // Optimización: Usar UPDATE directo con SQL raw para relaciones
    // Esto es mucho más rápido que hacer save() en un loop
    await this.dataSource.query(
      'UPDATE contacts SET company_id = NULL WHERE company_id = $1',
      [id]
    );

    // Ahora eliminar la compañía
    await this.companyRepo.delete(id);
    
    const duration = Date.now() - startTime;
    this.logger.log(`Company ${id} deleted in ${duration}ms (optimized: bulk update contacts)`);
  }

  async assignContactsToCompany(companyId: number, contactIds: number[]): Promise<void> {
    const startTime = Date.now();
    
    // Verificar que la compañía existe
    const company = await this.companyRepo.findOne({ 
      where: { id: companyId },
      select: ['id']
    });
    if (!company) {
      throw new ResourceNotFoundException(`Company not found with id: ${companyId}`);
    }

    // Obtener IDs de contactos actuales (sin cargar entidades completas)
    const currentContacts = await this.contactRepo.find({
      where: { company: { id: companyId } },
      select: ['id'],
    });
    const currentContactIds = currentContacts.map(c => c.id);

    // Identificar contactos a remover y a agregar
    const contactsToRemove = currentContactIds.filter(id => !contactIds.includes(id));
    const contactsToAdd = contactIds.filter(id => !currentContactIds.includes(id));

    // Validar que todos los contactos a agregar existen
    if (contactsToAdd.length > 0) {
      const existingContacts = await this.contactRepo.find({
        where: contactsToAdd.map(id => ({ id })),
        select: ['id'],
      });
      const existingContactIds = existingContacts.map(c => c.id);
      const missingContacts = contactsToAdd.filter(id => !existingContactIds.includes(id));
      
      if (missingContacts.length > 0) {
        throw new ResourceNotFoundException(
          `Contact(s) not found with id(s): ${missingContacts.join(', ')}`
        );
      }
    }

    // Optimización: Usar UPDATE directo con SQL raw para relaciones
    // Remover compañía de contactos que ya no están seleccionados
    if (contactsToRemove.length > 0) {
      await this.dataSource.query(
        'UPDATE contacts SET company_id = NULL WHERE id = ANY($1::int[])',
        [contactsToRemove]
      );
    }

    // Asignar compañía a contactos seleccionados usando SQL directo
    if (contactsToAdd.length > 0) {
      await this.dataSource.query(
        'UPDATE contacts SET company_id = $1 WHERE id = ANY($2::int[])',
        [companyId, contactsToAdd]
      );
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Assigned ${contactsToAdd.length} contacts, removed ${contactsToRemove.length} contacts from company ${companyId} in ${duration}ms (optimized: bulk updates)`
    );
  }
}
