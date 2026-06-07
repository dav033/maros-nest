import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { Contact } from '../../../entities/contact.entity';
import { Company } from '../../../entities/company.entity';
import { Project } from '../../../entities/project.entity';
import { LeadsRepository } from './repositories/leads.repository';
import { LeadMapper } from './mappers/lead.mapper';
import { ContactsService } from '../../contacts/contact-management/services/contacts.service';
import { CreateContactDto } from '../../contacts/contact-management/dto/create-contact.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadNumberValidationResponseDto } from './dto/lead-number-validation-response.dto';
import { LeadNumberingService } from './services/lead-numbering.service';
import { LeadMutationService } from './services/lead-mutation.service';
import {
  ValidationException,
  LeadExceptions,
  ContactExceptions,
  DatabaseException,
} from '../../../common/exceptions';
import { ProjectQboEnrichmentService } from '../../quickbooks/services/crm-bridge/project-qbo-enrichment.service';
import { MailService } from '../../mail/services/mail.service';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly leadsRepository: LeadsRepository,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly leadMapper: LeadMapper,
    private readonly contactsService: ContactsService,
    private readonly leadNumberingService: LeadNumberingService,
    private readonly leadMutationService: LeadMutationService,
    private readonly dataSource: DataSource,
    private readonly qboEnrichment: ProjectQboEnrichmentService,
    private readonly mailService: MailService,
  ) {}

  async getAllLeads(options: { includeQbo?: boolean } = {}): Promise<any[]> {
    return this.mapLeadList(this.leadsRepository.findAll(), options);
  }

  async getPipelineLeads(options: { includeQbo?: boolean } = {}): Promise<any[]> {
    return this.mapLeadList(this.leadsRepository.findPipeline(), options);
  }

  async getLeadsByType(
    type: LeadType,
    options: { includeQbo?: boolean } = {},
  ): Promise<any[]> {
    return this.mapLeadList(this.leadsRepository.findByLeadType(type), options);
  }

  async getLeadsInReview(options: { includeQbo?: boolean } = {}): Promise<any[]> {
    return this.mapLeadList(this.leadsRepository.findInReview(), options);
  }

  async getLeadById(id: number, options: { includeQbo?: boolean } = {}): Promise<any> {
    const entity = await this.leadsRepository.findByIdWithRelations(id);
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }
    const dto = this.leadMapper.toDto(entity);
    if (options.includeQbo !== false) {
      await this.qboEnrichment.enrichLead(dto);
    }
    return dto;
  }

  async getLeadDetails(
    id: number,
    options: { includeQbo?: boolean } = {},
  ): Promise<any> {
    const lead = await this.leadsRepository.findByIdWithRelations(id);
    if (!lead) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    // Get project if exists
    const project = lead.project
      ? await this.projectRepo.findOne({
          where: { id: lead.project.id },
          relations: ['lead'],
        })
      : null;

    const leadDto = this.leadMapper.toDto(lead);
    const dto = {
      ...leadDto,
      project: project
        ? this.leadMutationService.mapProjectToDto(project)
        : null,
    };

    if (options.includeQbo !== false) {
      await this.qboEnrichment.enrichLead(dto, { depth: 'full' });
    }

    return dto;
  }

  async getLeadsByStatus(
    status: LeadStatus,
    options: { includeQbo?: boolean } = {},
  ): Promise<any[]> {
    return this.mapLeadList(this.leadsRepository.findByStatus(status), options);
  }

  async getStatusCounts(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; count: number; estimatedValue: number }>> {
    return this.leadsRepository.getStatusCounts(leadType);
  }

  async getTotalCount(leadType?: LeadType): Promise<number> {
    return this.leadsRepository.getTotalCount(leadType);
  }

  async getLeadsByContactId(
    contactId: number,
    options: { includeQbo?: boolean } = {},
  ): Promise<any[]> {
    return this.mapLeadList(
      this.leadsRepository.findByContactId(contactId),
      options,
    );
  }

  async getLeadsByContactName(
    name: string,
    options: { includeQbo?: boolean } = {},
  ): Promise<any[]> {
    return this.mapLeadList(
      this.leadsRepository.findByContactName(name),
      options,
    );
  }

  async searchLeads(
    query: string,
    options: { includeQbo?: boolean } = {},
  ): Promise<any[]> {
    return this.mapLeadList(this.leadsRepository.searchByName(query), options);
  }

  private async mapLeadList(
    source: Promise<Lead[]>,
    options: { includeQbo?: boolean } = {},
  ): Promise<any[]> {
    const entities = await source;
    const dtos = entities.map((entity) => this.leadMapper.toDto(entity));
    if (options.includeQbo) {
      await this.qboEnrichment.enrichLeads(dtos);
    }
    return dtos;
  }

  async getLeadByNumber(
    leadNumber: string,
    options: { includeQbo?: boolean } = {},
  ): Promise<any> {
    const trimmedLeadNumber = leadNumber?.trim();
    if (!trimmedLeadNumber) {
      throw ValidationException.format('Lead number is required');
    }

    const entity =
      await this.leadsRepository.findByLeadNumberWithRelations(
        trimmedLeadNumber,
      );
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundByNumberException(trimmedLeadNumber);
    }

    const dto = this.leadMapper.toDto(entity);
    if (options.includeQbo !== false) {
      await this.qboEnrichment.enrichLead(dto);
    }
    return dto;
  }

  async createLeadWithNewContact(
    leadDto: CreateLeadDto,
    contactDto: CreateContactDto,
    leadTypeForGeneration?: LeadType,
  ): Promise<any> {
    if (!contactDto.address && leadDto.location) {
      contactDto.address = leadDto.location;
    }
    if (!contactDto.addressLink && leadDto.addressLink) {
      contactDto.addressLink = leadDto.addressLink;
    }
    const savedContact = await this.contactsService.create(contactDto);
    const savedContactId = (savedContact as { id?: unknown }).id;
    if (typeof savedContactId !== 'number') {
      throw new ContactExceptions.ContactNotFoundException('created contact');
    }
    const contactEntity = await this.contactRepo.findOne({
      where: { id: savedContactId },
    });
    if (!contactEntity) {
      throw new ContactExceptions.ContactNotFoundException(savedContactId);
    }
    return this.persistLead(leadDto, contactEntity, leadTypeForGeneration);
  }

  async createLeadWithExistingContact(
    leadDto: CreateLeadDto,
    contactId: number,
    leadTypeForGeneration?: LeadType,
  ): Promise<any> {
    const contactEntity = await this.contactRepo.findOne({
      where: { id: contactId },
    });
    if (!contactEntity) {
      throw new ContactExceptions.ContactNotFoundException(contactId);
    }
    return this.persistLead(leadDto, contactEntity, leadTypeForGeneration);
  }

  private async persistLead(
    leadDto: CreateLeadDto,
    contact: Contact,
    leadTypeForGeneration?: LeadType,
  ): Promise<any> {
    await this.leadNumberingService.applyDefaults(
      leadDto,
      leadTypeForGeneration,
    );

    // Auto-generate lead name if empty and we have the necessary data: {leadNumber}-{location}
    // Name can be null if not provided and cannot be auto-generated
    if (
      (!leadDto.name || leadDto.name.trim() === '') &&
      leadDto.leadNumber &&
      leadDto.location &&
      leadDto.location.trim() !== ''
    ) {
      leadDto.name = `${leadDto.leadNumber}-${leadDto.location.trim()}`;
    }

    // Get projectTypeId from ProjectType object or throw error if not present
    let projectTypeId: number | null = null;
    if (leadDto.projectTypeId) {
      projectTypeId = leadDto.projectTypeId;
    }

    const entity = this.leadMapper.toEntity(leadDto);
    entity.contact = contact;
    if (projectTypeId) {
      entity.projectType = await this.leadMutationService.resolveProjectType(
        projectTypeId,
      );
    }

    // Ensure ID is not set (should be auto-generated)
    delete (entity as any).id;

    try {
      const saved = await this.leadRepo.save(entity);
      const dto = this.leadMapper.toDto(saved);
      return dto;
    } catch (error: unknown) {
      const normalizedError = this.toError(error);
      this.logger.error(
        `Error saving lead: ${normalizedError?.message ?? 'Unknown error'}`,
      );
      throw new LeadExceptions.LeadCreationException(
        'Data integrity error creating lead',
        normalizedError,
      );
    }
  }

  async updateLead(id: number, patchDto: CreateLeadDto): Promise<any> {
    // Optimización: Si solo se están actualizando las notas, usar método optimizado
    const isNotesOnlyUpdate = this.leadMutationService.isNotesOnlyUpdate(
      patchDto,
    );
    if (isNotesOnlyUpdate) {
      return this.leadMutationService.updateLeadNotesOnly(
        id,
        patchDto.notes || [],
      );
    }

    // Verificar existencia primero (sin cargar relaciones si no es necesario)
    const exists = await this.leadRepo.findOne({
      where: { id },
      select: ['id', 'leadNumber'],
    });

    if (!exists) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    // Validar leadNumber si está cambiando
    if (patchDto.leadNumber && patchDto.leadNumber !== exists.leadNumber) {
      const leadNumberExists =
        await this.leadsRepository.existsByLeadNumberAndIdNot(
          patchDto.leadNumber,
          id,
        );
      if (leadNumberExists) {
        throw ValidationException.format(
          'Lead number already exists: %s',
          patchDto.leadNumber,
        );
      }
    }

    // Cargar entity completo solo si necesitamos actualizar relaciones
    const needsRelations =
      patchDto.contactId !== undefined || patchDto.projectTypeId !== undefined || patchDto.status !== undefined;
    const entity = await this.leadRepo.findOne({
      where: { id },
      relations: needsRelations ? ['contact', 'projectType'] : [],
    });

    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    const previousStatus = entity.status;

    await this.leadMutationService.updateEntityFields(patchDto, entity);
    await this.dataSource.manager.save(entity);

    let conversion: { converted: boolean; projectId?: number } = {
      converted: false,
    };

    const becameWon =
      previousStatus !== LeadStatus.WON && entity.status === LeadStatus.WON;
    this.logger.log(`updateLead #${id} — previousStatus: ${previousStatus}, newStatus: ${entity.status}, becameWon: ${becameWon}`);
    if (becameWon) {
      let project = await this.projectRepo.findOne({ where: { lead: { id } } });
      if (!project) {
        this.logger.log(`Creating new project for lead #${id}`);
        project = this.projectRepo.create();
        project.lead = entity;
        project.attachments = entity.attachments ?? [];
        project = await this.projectRepo.save(project);
        this.logger.log(`Created project #${project.id} for lead #${id}`);
      } else {
        this.logger.log(`Existing project #${project.id} found for lead #${id}`);
      }
      entity.project = project;
      conversion = { converted: true, projectId: project.id };

      const leadLabel = entity.leadNumber ?? entity.name ?? `Lead #${id}`;
      const contactEmail = entity.contact?.email;
      this.logger.log(`Sending WON notification email for lead "${leadLabel}" (id: ${id}, project: ${project.id}, contactEmail: ${contactEmail ?? 'none'})`);
      try {
        const textBody = `El lead "${entity.name ?? entity.leadNumber}" ha pasado a estado WON y se ha creado el proyecto #${project.id}.\n\nFecha: ${new Date().toLocaleString()}${contactEmail ? `\n\nContacto: ${entity.contact?.name ?? 'N/A'} <${contactEmail}>` : ''}`;
        const mailResult = await this.mailService.sendMail({
          to: ['info@marosconstruction.com'],
          subject: `Lead Won: ${leadLabel} convertido a proyecto`,
          text: textBody,
        });
        this.logger.log(`WON notification email sent — messageId: ${mailResult.messageId ?? 'N/A'}`);
      } catch (err) {
        this.logger.warn(`WON notification email failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const dto = this.leadMapper.toDto(entity);
    return { ...dto, conversion };
  }

  async getLeadRejectionInfo(id: number): Promise<{
    lead: { id: number; name: string };
    contact: {
      id: number;
      name: string;
      canDelete: boolean;
      otherLeadsCount: number;
    } | null;
    company: {
      id: number;
      name: string;
      canDelete: boolean;
      otherLeadsCount: number;
    } | null;
  }> {
    const lead = await this.leadRepo.findOne({
      where: { id },
      relations: ['contact', 'contact.company'],
    });

    if (!lead) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    let contactInfo: {
      id: number;
      name: string;
      canDelete: boolean;
      otherLeadsCount: number;
    } | null = null;
    let companyInfo: {
      id: number;
      name: string;
      canDelete: boolean;
      otherLeadsCount: number;
    } | null = null;

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
          .where('contact.company_id = :companyId', {
            companyId: lead.contact.company.id,
          })
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
  ): Promise<{
    message: string;
    deletedContact?: boolean;
    deletedCompany?: boolean;
  }> {
    const entity = await this.leadRepo.findOne({
      where: { id },
      relations: ['contact', 'contact.company'],
    });
    if (!entity) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    const contactId = entity.contact?.id;
    const companyId = entity.contact?.company?.id;

    try {
      await this.dataSource.query(
        'UPDATE projects SET lead_id = NULL WHERE lead_id = $1',
        [id],
      );

      const leadWithRelations =
        await this.leadsRepository.findByIdWithRelations(id);
      if (!leadWithRelations) {
        throw new LeadExceptions.LeadNotFoundException(id);
      }

      await this.leadRepo.remove(leadWithRelations);

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

          if (
            companyContactsCount === 0 ||
            (companyContactsCount === 1 && options?.deleteContact)
          ) {
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
        }
      }

      return {
        message: 'Lead deleted successfully',
        deletedContact,
        deletedCompany,
      };
    } catch (error: unknown) {
      throw new DatabaseException(
        'Cannot delete lead due to existing references',
        this.toError(error),
      );
    }
  }

  async validateLeadNumber(
    leadNumber: string,
  ): Promise<LeadNumberValidationResponseDto> {
    return this.leadNumberingService.validateLeadNumber(leadNumber);
  }

  private toError(error: unknown): Error | undefined {
    if (error instanceof Error) return error;
    if (error === undefined || error === null) return undefined;
    return new Error(String(error));
  }
}
