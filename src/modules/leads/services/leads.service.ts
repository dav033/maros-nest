import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { Contact } from '../../../entities/contact.entity';
import { Company } from '../../../entities/company.entity';
import { ProjectType } from '../../../entities/project-type.entity';
import { Project } from '../../../entities/project.entity';
import { LeadsRepository } from '../repositories/leads.repository';
import { LeadMapper } from '../mappers/lead.mapper';
import { ContactsService } from '../../contacts/services/contacts.service';
import { LeadClickUpSyncService } from './lead-clickup-sync.service';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadNumberValidationResponseDto } from '../dto/lead-number-validation-response.dto';
import { ValidationException, LeadExceptions, ContactExceptions, ProjectTypeExceptions, DatabaseException } from '../../../common/exceptions';
import { getLeadTypeFromNumber } from '../../../common/utils/lead-type.utils';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);
  private static readonly LEAD_NO_FMT = 'MMyy';

  constructor(
    private readonly leadsRepository: LeadsRepository,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(ProjectType)
    private readonly projectTypeRepo: Repository<ProjectType>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly leadMapper: LeadMapper,
    private readonly contactsService: ContactsService,
    private readonly clickUpSyncService: LeadClickUpSyncService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ejecuta una tarea en background sin bloquear la respuesta al cliente
   * Usa setImmediate para ejecutar después de que la respuesta se haya enviado
   * @deprecated Usar executeInBackground de common/utils/background-tasks.util en su lugar
   */
  private executeInBackground(task: () => Promise<void>, taskName: string): void {
    setImmediate(async () => {
      try {
        await task();
      } catch (error: any) {
        this.logger.error(`Error in background task ${taskName}: ${error.message}`, error.stack);
        // No re-throw - las tareas en background no deben afectar la respuesta
      }
    });
  }

  async getAllLeads(): Promise<any[]> {
    const entities = await this.leadsRepository.findAll();
    return entities.map((entity) => this.leadMapper.toDto(entity));
  }

  async getLeadsByType(type: LeadType): Promise<any[]> {
    const entities = await this.leadsRepository.findByLeadType(type);
    return entities.map((entity) => this.leadMapper.toDto(entity));
  }

  async getLeadsInReview(): Promise<any[]> {
    const entities = await this.leadsRepository.findInReview();
    return entities.map((entity) => this.leadMapper.toDto(entity));
  }

  async getLeadById(id: number): Promise<any> {
    const entity = await this.leadsRepository.findByIdWithRelations(id);
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }
    return this.leadMapper.toDto(entity);
  }

  async getLeadDetails(id: number): Promise<any> {
    const lead = await this.leadsRepository.findByIdWithRelations(id);
    if (!lead) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    // Get project if exists
    const project = lead.project ? await this.projectRepo.findOne({
      where: { id: lead.project.id },
      relations: ['lead'],
    }) : null;

    const leadDto = this.leadMapper.toDto(lead);

    return {
      ...leadDto,
      project: project ? this.mapProjectToDto(project) : null,
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

  async getLeadByNumber(leadNumber: string): Promise<any> {
    const trimmedLeadNumber = leadNumber?.trim();
    if (!trimmedLeadNumber) {
      throw ValidationException.format('Lead number is required');
    }

    const entity = await this.leadsRepository.findByLeadNumberWithRelations(trimmedLeadNumber);
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundByNumberException(trimmedLeadNumber);
    }

    return this.leadMapper.toDto(entity);
  }

  async createLeadWithNewContact(
    leadDto: CreateLeadDto,
    contactDto: any,
    skipClickUpSync: boolean = false,
    leadTypeForGeneration?: LeadType,
  ): Promise<any> {
    const savedContact = await this.contactsService.create(contactDto);
    const contactEntity = await this.contactRepo.findOne({ where: { id: savedContact.id } });
    if (!contactEntity) {
      throw new ContactExceptions.ContactNotFoundException(savedContact.id);
    }
    return this.persistLead(leadDto, contactEntity, skipClickUpSync, leadTypeForGeneration);
  }

  async createLeadWithExistingContact(
    leadDto: CreateLeadDto,
    contactId: number,
    skipClickUpSync: boolean = false,
    leadTypeForGeneration?: LeadType,
  ): Promise<any> {
    const contactEntity = await this.contactRepo.findOne({ where: { id: contactId } });
    if (!contactEntity) {
      throw new ContactExceptions.ContactNotFoundException(contactId);
    }
    return this.persistLead(leadDto, contactEntity, skipClickUpSync, leadTypeForGeneration);
  }

  private async persistLead(
    leadDto: CreateLeadDto,
    contact: Contact,
    skipClickUpSync: boolean,
    leadTypeForGeneration?: LeadType,
  ): Promise<any> {
    await this.applyDefaults(leadDto, leadTypeForGeneration);

    // Auto-generate lead name if empty and we have the necessary data: {leadNumber}-{location}
    // Name can be null if not provided and cannot be auto-generated
    if ((!leadDto.name || leadDto.name.trim() === '') && leadDto.leadNumber && leadDto.location && leadDto.location.trim() !== '') {
      leadDto.name = `${leadDto.leadNumber}-${leadDto.location.trim()}`;
    }

    // Get projectTypeId from ProjectType object or throw error if not present
    let projectTypeId: number | null = null;
    if (leadDto.projectTypeId) {
      projectTypeId = leadDto.projectTypeId;
    }

    if (!projectTypeId) {
      throw ValidationException.format('Project Type is required');
    }

    const projectType = await this.resolveProjectType(projectTypeId);
    const entity = this.leadMapper.toEntity(leadDto);
    entity.contact = contact;
    entity.projectType = projectType;

    // Ensure ID is not set (should be auto-generated)
    delete (entity as any).id;
    
    this.logger.log(`About to save lead entity: ${JSON.stringify({
      leadNumber: entity.leadNumber,
      name: entity.name,
      location: entity.location,
      addressLink: entity.addressLink,
      hasId: !!(entity as any).id
    })}`);

    try {
      const saved = await this.leadRepo.save(entity);
      const dto = this.leadMapper.toDto(saved);

      // Responder al cliente primero, luego sincronizar con ClickUp en background
      if (!skipClickUpSync) {
        this.executeInBackground(
          async () => {
            await this.clickUpSyncService.syncLeadCreate(saved);
            this.logger.log(`ClickUp sync completed for lead ${dto.id} (${dto.leadNumber})`);
          },
          `ClickUp sync for lead ${dto.id} creation`
        );
      } else {
        this.logger.log(`Skip ClickUp sync on create for lead ${dto.id} (${dto.leadNumber})`);
      }

      return dto;
    } catch (error) {
      this.logger.error(`Error saving lead: ${error.message}`, error.stack);
      throw new LeadExceptions.LeadCreationException('Data integrity error creating lead', error);
    }
  }

  async updateLead(id: number, patchDto: CreateLeadDto): Promise<any> {
    const startTime = Date.now();
    
    // Optimización: Si solo se están actualizando las notas, usar método optimizado
    const isNotesOnlyUpdate = this.isNotesOnlyUpdate(patchDto);
    if (isNotesOnlyUpdate) {
      return this.updateLeadNotesOnly(id, patchDto.notes || []);
    }

    // Verificar existencia primero (sin cargar relaciones si no es necesario)
    const exists = await this.leadRepo.findOne({ 
      where: { id },
      select: ['id', 'leadNumber']
    });
    
    if (!exists) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    // Validar leadNumber si está cambiando
    if (patchDto.leadNumber && patchDto.leadNumber !== exists.leadNumber) {
      const leadNumberExists = await this.leadsRepository.existsByLeadNumberAndIdNot(patchDto.leadNumber, id);
      if (leadNumberExists) {
        throw ValidationException.format('Lead number already exists: %s', patchDto.leadNumber);
      }
    }

    this.logger.log(`Updating lead ${id} with data: ${JSON.stringify(patchDto)}`);
    
    // Cargar entity completo solo si necesitamos actualizar relaciones
    const needsRelations = patchDto.contactId !== undefined || patchDto.projectTypeId !== undefined;
    const entity = await this.leadRepo.findOne({ 
      where: { id },
      relations: needsRelations ? ['contact', 'projectType'] : []
    });
    
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }
    
    await this.updateEntityFields(patchDto, entity);
    await this.dataSource.manager.save(entity);

    const dto = this.leadMapper.toDto(entity);
    
    // Responder al cliente primero, luego sincronizar con ClickUp en background
    this.executeInBackground(
      async () => {
        await this.clickUpSyncService.syncLeadUpdate(entity);
        this.logger.log(`ClickUp sync completed for lead update ${dto.id}`);
      },
      `ClickUp sync for lead ${dto.id} update`
    );
    
    const duration = Date.now() - startTime;
    this.logger.log(`Lead ${id} updated in ${duration}ms (ClickUp sync in background)`);
    
    return dto;
  }

  /**
   * Método optimizado para actualizar solo las notas de un lead
   * Usa UPDATE directo sin cargar relaciones antes de la actualización
   */
  private async updateLeadNotesOnly(id: number, notes: string[]): Promise<any> {
    const startTime = Date.now();
    
    // UPDATE directo usando query builder (mucho más rápido que save con relaciones)
    // No necesitamos verificar existencia primero, el UPDATE fallará si no existe
    const updateResult = await this.leadRepo
      .createQueryBuilder()
      .update(Lead)
      .set({ notes })
      .where('id = :id', { id })
      .execute();

    if (updateResult.affected === 0) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    // Cargar el lead actualizado SOLO después del UPDATE exitoso
    // Cargamos relaciones porque el DTO las necesita, pero solo después del UPDATE
    const updated = await this.leadRepo.findOne({ 
      where: { id },
      relations: ['contact', 'projectType']
    });

    if (!updated) {
      // Esto no debería pasar, pero por seguridad
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    const dto = this.leadMapper.toDto(updated);
    const duration = Date.now() - startTime;
    this.logger.log(`Notes updated for lead ${id} (optimized: no pre-load, no ClickUp) in ${duration}ms`);
    
    return dto;
  }

  /**
   * Determina si el DTO solo contiene actualizaciones de notas
   * Esto permite optimizar la operación saltando la sincronización con ClickUp
   */
  private isNotesOnlyUpdate(patchDto: CreateLeadDto): boolean {
    // Verificar si hay algún campo diferente a notes definido
    if (patchDto.leadNumber !== undefined ||
        patchDto.name !== undefined ||
        patchDto.startDate !== undefined ||
        patchDto.location !== undefined ||
        patchDto.addressLink !== undefined ||
        patchDto.status !== undefined ||
        patchDto.contactId !== undefined ||
        patchDto.projectTypeId !== undefined ||
        patchDto.inReview !== undefined) {
      return false;
    }
    
    // Si notes está definido y es el único campo, es una actualización solo de notas
    return patchDto.notes !== undefined;
  }

  private async updateEntityFields(dto: CreateLeadDto, entity: Lead): Promise<void> {
    // Lead number should not be cleared once set, only updated to a valid value
    if (dto.leadNumber !== undefined && dto.leadNumber !== null && dto.leadNumber.trim() !== '') {
      entity.leadNumber = dto.leadNumber;
    }
    if (dto.name !== undefined) {
      entity.name = dto.name;
    }
    if (dto.startDate !== undefined) {
      // Handle both Date objects and string dates, can be null
      if (dto.startDate === null || dto.startDate === '') {
        entity.startDate = undefined;
      } else if (typeof dto.startDate === 'string') {
        entity.startDate = new Date(dto.startDate);
      } else {
        entity.startDate = dto.startDate;
      }
    }
    if (dto.location !== undefined) {
      entity.location = dto.location;
    }
    if (dto.addressLink !== undefined) {
      entity.addressLink = dto.addressLink;
    }
    if (dto.status !== undefined) {
      entity.status = dto.status;
    }
    // leadType ya no se almacena, se determina desde leadNumber
    if (dto.contactId !== undefined) {
      // Permitir limpiar la relación de contacto enviando contactId = null
      if (dto.contactId === null) {
        entity.contact = null;
      } else {
        const contactEntity = await this.contactRepo.findOne({
          where: { id: dto.contactId },
        });
        if (!contactEntity) {
          throw new ContactExceptions.ContactNotFoundException(dto.contactId);
        }
        entity.contact = contactEntity;
      }
    }
    if (dto.projectTypeId !== undefined) {
      const projectTypeEntity = await this.projectTypeRepo.findOne({ where: { id: dto.projectTypeId } });
      if (!projectTypeEntity) {
        throw new ProjectTypeExceptions.ProjectTypeNotFoundException(dto.projectTypeId);
      }
      entity.projectType = projectTypeEntity;
    }
    if (dto.notes !== undefined) {
      entity.notes = dto.notes;
    }
    if (dto.inReview !== undefined) {
      entity.inReview = dto.inReview;
    }
  }

  async getLeadRejectionInfo(id: number): Promise<{
    lead: { id: number; name: string };
    contact: { id: number; name: string; canDelete: boolean; otherLeadsCount: number } | null;
    company: { id: number; name: string; canDelete: boolean; otherLeadsCount: number } | null;
  }> {
    const lead = await this.leadRepo.findOne({
      where: { id },
      relations: ['contact', 'contact.company'],
    });

    if (!lead) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    let contactInfo: { id: number; name: string; canDelete: boolean; otherLeadsCount: number } | null = null;
    let companyInfo: { id: number; name: string; canDelete: boolean; otherLeadsCount: number } | null = null;

    if (lead.contact) {
      // Count other leads for this contact (excluding current lead)
      const otherContactLeads = await this.leadRepo.count({
        where: { contact: { id: lead.contact.id } },
      });
      const otherLeadsCount = otherContactLeads - 1; // Exclude current lead

      contactInfo = {
        id: lead.contact.id,
        name: lead.contact.name || 'Unknown',
        canDelete: otherLeadsCount === 0,
        otherLeadsCount,
      };

      if (lead.contact.company) {
        // Count other leads for contacts in this company (excluding current lead)
        const otherCompanyLeads = await this.leadRepo
          .createQueryBuilder('lead')
          .innerJoin('lead.contact', 'contact')
          .where('contact.company_id = :companyId', { companyId: lead.contact.company.id })
          .getCount();
        const companyOtherLeadsCount = otherCompanyLeads - 1; // Exclude current lead

        companyInfo = {
          id: lead.contact.company.id,
          name: lead.contact.company.name || 'Unknown',
          canDelete: companyOtherLeadsCount === 0,
          otherLeadsCount: companyOtherLeadsCount,
        };
      }
    }

    return {
      lead: { id: lead.id, name: lead.name || 'Unknown' },
      contact: contactInfo,
      company: companyInfo,
    };
  }

  async deleteLead(
    id: number,
    options?: { deleteContact?: boolean; deleteCompany?: boolean },
  ): Promise<{ message: string; deletedContact?: boolean; deletedCompany?: boolean }> {
    const entity = await this.leadRepo.findOne({
      where: { id },
      relations: ['contact', 'contact.company'],
    });
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    const contactId = entity.contact?.id;
    const companyId = entity.contact?.company?.id;

    const dto = this.leadMapper.toDto(entity);

    // Guardar referencia para usar en background (antes de eliminar)
    const leadForSync = { ...entity };
    const leadId = entity.id;
    const leadNumber = entity.leadNumber;

    try {
      // Optimización: Usar UPDATE directo con SQL raw para relaciones
      // Clear lead references from projects before deletion
      await this.dataSource.query(
        'UPDATE projects SET lead_id = NULL WHERE lead_id = $1',
        [id]
      );

      // Load entity with all relations
      const leadWithRelations = await this.leadsRepository.findByIdWithRelations(id);
      if (!leadWithRelations) {
        throw new LeadExceptions.LeadNotFoundException(id);
      }

      await this.leadRepo.remove(leadWithRelations);

      // Responder al cliente primero, luego sincronizar con ClickUp en background
      this.executeInBackground(
        async () => {
          await this.clickUpSyncService.syncLeadDelete(leadForSync);
          this.logger.log(`ClickUp sync completed for lead deletion ${leadId} (${leadNumber})`);
        },
        `ClickUp sync for lead ${leadId} deletion`
      );

      let deletedContact = false;
      let deletedCompany = false;

      // Delete company first (if requested and safe)
      if (options?.deleteCompany && companyId) {
        const companyLeadsCount = await this.leadRepo
          .createQueryBuilder('lead')
          .innerJoin('lead.contact', 'contact')
          .where('contact.company_id = :companyId', { companyId })
          .getCount();

        if (companyLeadsCount === 0) {
          // Check if company has other contacts
          const companyContactsCount = await this.contactRepo.count({
            where: { company: { id: companyId } },
          });

          if (companyContactsCount === 0 || (companyContactsCount === 1 && options?.deleteContact)) {
            // Safe to delete company after contact
          }
        }
      }

      // Delete contact (if requested and safe)
      if (options?.deleteContact && contactId) {
        const contactLeadsCount = await this.leadRepo.count({
          where: { contact: { id: contactId } },
        });

        if (contactLeadsCount === 0) {
          await this.contactRepo.delete(contactId);
          deletedContact = true;
          this.logger.log(`Deleted orphan contact ${contactId}`);
        }
      }

      // Now delete company if safe
      if (options?.deleteCompany && companyId) {
        const companyContactsCount = await this.contactRepo.count({
          where: { company: { id: companyId } },
        });

        if (companyContactsCount === 0) {
          await this.dataSource.getRepository(Company).delete(companyId);
          deletedCompany = true;
          this.logger.log(`Deleted orphan company ${companyId}`);
        }
      }

      return {
        message: 'Lead deleted successfully',
        deletedContact,
        deletedCompany,
      };
    } catch (error) {
      throw new DatabaseException('Cannot delete lead due to existing references', error);
    }
  }

  private async applyDefaults(leadDto: CreateLeadDto, leadTypeForGeneration?: LeadType): Promise<void> {
    leadDto.status = leadDto.status || LeadStatus.NOT_EXECUTED;
    
    // startDate can be null, no default assignment

    if (!leadDto.leadNumber || leadDto.leadNumber.trim() === '') {
      // Si no se proporciona leadNumber, generar uno según el tipo proporcionado o CONSTRUCTION por defecto
      const typeToUse = leadTypeForGeneration || LeadType.CONSTRUCTION;
      leadDto.leadNumber = await this.generateLeadNumber(typeToUse);
    } else {
      // Validate that the provided lead number doesn't already exist
      const exists = await this.leadsRepository.existsByLeadNumber(leadDto.leadNumber);
      if (exists) {
        throw ValidationException.format('Lead number already exists: %s', leadDto.leadNumber);
      }
    }

    // Auto-generate name if not provided and we have the necessary data: {leadNumber}-{location}
    // Name can be null if not provided and cannot be auto-generated
    if ((!leadDto.name || leadDto.name.trim() === '') && leadDto.leadNumber && leadDto.location) {
      leadDto.name = `${leadDto.leadNumber}-${leadDto.location}`;
    }
  }


  private async generateLeadNumber(type: LeadType): Promise<string> {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const mmyy = `${month}${year}`;

    // Get all lead numbers of this type
    const allLeadNumbers = await this.leadsRepository.findAllLeadNumbersByType(type);

    // Extract numeric prefixes and find max
    const max = allLeadNumbers
      .map((s) => {
        if (!s) return -1;
        if (type === LeadType.ROOFING && /^\d{3}R-\d{4}$/.test(s)) {
          return parseInt(s.substring(0, 3), 10);
        }
        if (type === LeadType.PLUMBING && /^\d{3}P-\d{4}$/.test(s)) {
          return parseInt(s.substring(0, 3), 10);
        }
        if (type === LeadType.CONSTRUCTION && /^\d{3}-\d{4}$/.test(s)) {
          return parseInt(s.substring(0, 3), 10);
        }
        return -1;
      })
      .filter((i) => i >= 0)
      .reduce((prev, curr) => Math.max(prev, curr), 0);

    const next = max + 1;
    const base = String(next).padStart(3, '0');

    if (type === LeadType.ROOFING) {
      return `${base}R-${mmyy}`;
    } else if (type === LeadType.PLUMBING) {
      return `${base}P-${mmyy}`;
    } else {
      return `${base}-${mmyy}`;
    }
  }

  private async resolveProjectType(id: number): Promise<ProjectType> {
    const projectType = await this.projectTypeRepo.findOne({ where: { id } });
    if (!projectType) {
      throw new ProjectTypeExceptions.ProjectTypeNotFoundException(id);
    }
    return projectType;
  }

  async validateLeadNumber(leadNumber: string): Promise<LeadNumberValidationResponseDto> {
    if (!leadNumber || leadNumber.trim() === '') {
      return {
        valid: false,
        reason: 'Lead number is required',
      };
    }

    const trimmedLeadNumber = leadNumber.trim();
    const exactExists = await this.leadsRepository.existsByLeadNumber(trimmedLeadNumber);
    
    if (exactExists) {
      return {
        valid: false,
        reason: 'Lead number already exists',
      };
    }

    const numericPrefix = this.extractNumericPrefix(trimmedLeadNumber);
    if (!numericPrefix) {
      return {
        valid: false,
        reason: 'Invalid lead number format',
      };
    }

    const prefixInUse = await this.isNumericPrefixInUse(numericPrefix);
    if (prefixInUse) {
      return {
        valid: false,
        reason: `Lead number prefix ${numericPrefix} is already in use`,
      };
    }

    return {
      valid: true,
      reason: 'OK',
    };
  }

  private extractNumericPrefix(leadNumber: string): string | null {
    if (/^\d{3}R-\d{4}$/.test(leadNumber) || /^\d{3}P-\d{4}$/.test(leadNumber) || /^\d{3}-\d{4}$/.test(leadNumber)) {
      return leadNumber.substring(0, 3);
    }
    return null;
  }

  private async isNumericPrefixInUse(numericPrefix: string): Promise<boolean> {
    for (const type of Object.values(LeadType)) {
      const allNumbers = await this.leadsRepository.findAllLeadNumbersByType(type as LeadType);
      const prefixExists = allNumbers.some((s) => {
        const existingPrefix = this.extractNumericPrefix(s);
        return numericPrefix === existingPrefix;
      });

      if (prefixExists) {
        return true;
      }
    }
    return false;
  }
}
