import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { Contact } from '../../../entities/contact.entity';
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

      if (!skipClickUpSync) {
        await this.clickUpSyncService.syncLeadCreate(saved);
        this.logger.log(`ClickUp sync completed for lead ${dto.id} (${dto.leadNumber})`);
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
    const entity = await this.leadRepo.findOne({ 
      where: { id },
      relations: ['contact', 'projectType']
    });
    
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    if (patchDto.leadNumber && patchDto.leadNumber !== entity.leadNumber) {
      const exists = await this.leadsRepository.existsByLeadNumberAndIdNot(patchDto.leadNumber, id);
      if (exists) {
        throw ValidationException.format('Lead number already exists: %s', patchDto.leadNumber);
      }
    }

    this.logger.log(`Updating lead ${id} with data: ${JSON.stringify(patchDto)}`);
    await this.updateEntityFields(patchDto, entity);
    await this.dataSource.manager.save(entity);

    const dto = this.leadMapper.toDto(entity);
    
    await this.clickUpSyncService.syncLeadUpdate(entity);
    this.logger.log(`ClickUp sync completed for lead update ${dto.id}`);
    
    return dto;
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
      const contactEntity = await this.contactRepo.findOne({ where: { id: dto.contactId } });
      if (!contactEntity) {
        throw new ContactExceptions.ContactNotFoundException(dto.contactId);
      }
      entity.contact = contactEntity;
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
  }

  async deleteLead(id: number): Promise<boolean> {
    const entity = await this.leadRepo.findOne({ where: { id } });
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    const dto = this.leadMapper.toDto(entity);

    await this.clickUpSyncService.syncLeadDelete(entity);
    this.logger.log(`ClickUp sync completed for lead deletion ${dto.id}`);

    try {
      // Clear lead references from projects before deletion
      const projects = await this.projectRepo.find({ where: { lead: { id } } });
      for (const project of projects) {
        project.lead = null as any;
        await this.projectRepo.save(project);
      }

      // Load entity with all relations
      const leadWithRelations = await this.leadsRepository.findByIdWithRelations(id);
      if (!leadWithRelations) {
        throw new LeadExceptions.LeadNotFoundException(id);
      }

      await this.leadRepo.remove(leadWithRelations);
      return true;
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
