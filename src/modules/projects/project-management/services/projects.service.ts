import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { Lead } from '../../../../entities/lead.entity';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectMapper } from '../mappers/project.mapper';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { SendEstimateEmailDto } from '../dto/send-estimate-email.dto';
import {
  ValidationException,
  ResourceNotFoundException,
} from '../../../../common/exceptions';
import { BaseService } from '../../../../common/services/base.service';
import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { ProjectQboEnrichmentService } from '../../../quickbooks/services/crm-bridge/project-qbo-enrichment.service';
import { S3Service } from '../../../s3/services/s3.service';
import { MailService } from '../../../mail/services/mail.service';

@Injectable()
export class ProjectsService extends BaseService<any, number, Project> {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly projectsRepository: ProjectsRepository,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    private readonly projectMapper: ProjectMapper,
    private readonly qboEnrichment: ProjectQboEnrichmentService,
    private readonly s3Service: S3Service,
    private readonly mailService: MailService,
  ) {
    super(projectRepo, projectMapper);
  }

  async create(dto: CreateProjectDto): Promise<any> {
    // Validate that lead exists and load contact relation
    const lead = await this.leadRepo.findOne({
      where: { id: dto.leadId },
      relations: ['contact'],
    });
    if (!lead) {
      throw ValidationException.format(
        'Lead not found with id: %s',
        dto.leadId.toString(),
      );
    }

    // Check if lead already has a project (1:1 relationship)
    const existingProject = await this.projectRepo.findOne({
      where: { lead: { id: dto.leadId } },
      relations: ['lead'],
    });
    if (existingProject) {
      throw ValidationException.format(
        'Lead with id %s already has a project',
        dto.leadId.toString(),
      );
    }

    const entity = this.projectMapper.toEntity(dto);
    entity.lead = lead;

    const saved = await this.projectRepo.save(entity);

    const wasNotWon = lead.status !== LeadStatus.WON;
    if (wasNotWon) {
      lead.status = LeadStatus.WON;
      await this.leadRepo.save(lead);
      this.logger.log(`Lead #${lead.id} status set to WON after project #${saved.id} creation`);
    }

    await this.sendWonNotificationEmail(lead, saved.id);

    return this.projectMapper.toDto(saved);
  }

  private async sendWonNotificationEmail(lead: Lead, projectId: number): Promise<void> {
    const leadLabel = lead.leadNumber ?? lead.name ?? `Lead #${lead.id}`;
    const contactEmail = lead.contact?.email;
    this.logger.log(`Sending WON notification email for lead "${leadLabel}" (id: ${lead.id}, project: ${projectId}, contactEmail: ${contactEmail ?? 'none'})`);
    try {
      const textBody = `El lead "${lead.name ?? lead.leadNumber}" ha pasado a estado WON y se ha creado el proyecto #${projectId}.\n\nFecha: ${new Date().toLocaleString()}${contactEmail ? `\n\nContacto: ${lead.contact?.name ?? 'N/A'} <${contactEmail}>` : ''}`;
      const mailResult = await this.mailService.sendMail({
        to: [
          'info@marosconstruction.com',
          'agonzales@marosconstruction.com',
        ],
        subject: `Lead Won: ${leadLabel} convertido a proyecto`,
        text: textBody,
      });
      this.logger.log(`WON notification email sent — messageId: ${mailResult.messageId ?? 'N/A'}`);
    } catch (err) {
      this.logger.warn(`WON notification email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async update(id: number, dto: UpdateProjectDto): Promise<any> {
    const entity = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead'],
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    // If leadId is being updated, validate the new lead
    if (dto.leadId !== undefined && dto.leadId !== entity.lead.id) {
      const newLead = await this.leadRepo.findOne({
        where: { id: dto.leadId },
      });
      if (!newLead) {
        throw ValidationException.format(
          'Lead not found with id: %s',
          dto.leadId.toString(),
        );
      }

      // Check if the new lead already has a project
      const existingProject = await this.projectRepo.findOne({
        where: { lead: { id: dto.leadId } },
      });
      if (existingProject && existingProject.id !== id) {
        throw ValidationException.format(
          'Lead with id %s already has a project',
          dto.leadId.toString(),
        );
      }

      entity.lead = newLead;
    }

    if (dto.leadName !== undefined) {
      const trimmedLeadName = this.normalizeLeadName(dto.leadName);
      if (!trimmedLeadName) {
        throw ValidationException.format('Lead name cannot be empty');
      }
      entity.lead.name = trimmedLeadName;
    }

    if (dto.leadNumber !== undefined) {
      const trimmedLeadNumber = this.normalizeLeadNumber(dto.leadNumber);
      if (!trimmedLeadNumber) {
        throw ValidationException.format('Lead number cannot be empty');
      }

      const existingLeadWithNumber = await this.leadRepo.count({
        where: {
          leadNumber: trimmedLeadNumber,
          id: Not(entity.lead.id),
        },
      });

      if (existingLeadWithNumber > 0) {
        throw ValidationException.format(
          'Lead number already exists: %s',
          trimmedLeadNumber,
        );
      }

      entity.lead.leadNumber = trimmedLeadNumber;
    }

    this.projectMapper.updateEntity(dto, entity);
    const saved = await this.projectRepo.save(entity);
    return this.projectMapper.toDto(saved);
  }

  private normalizeLeadName(value: string): string {
    return value.trim();
  }

  private normalizeLeadNumber(value: string): string {
    return value.trim();
  }

  async findAll(): Promise<any[]> {
    const startTime = Date.now();

    const entities = await this.projectRepo.find({
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });

    const dtos = entities.map((entity) => this.projectMapper.toDto(entity));
    await this.qboEnrichment.enrichProjectsSummary(dtos);

    const duration = Date.now() - startTime;
    this.logger.log(`Projects findAll completed in ${duration}ms`);

    return dtos;
  }

  async findById(id: number): Promise<any> {
    const startTime = Date.now();

    const entity = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead', 'lead.contact', 'lead.projectType'],
    });
    if (!entity) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    const dto = this.projectMapper.toDto(entity);
    await this.qboEnrichment.enrichProjectSummary(dto);

    const duration = Date.now() - startTime;
    this.logger.log(`Project ${id} findById completed in ${duration}ms`);

    return dto;
  }

  async getProjectDetails(id: number): Promise<any> {
    const project = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead', 'lead.contact', 'lead.contact.company', 'lead.projectType'],
    });

    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    const projectDto = this.projectMapper.toDto(project);

    // Map lead with contact information
    const leadDto = project.lead ? {
      id: project.lead.id,
      leadNumber: project.lead.leadNumber,
      name: project.lead.name,
      startDate: project.lead.startDate,
      location: project.lead.location,
      addressLink: project.lead.addressLink,
      status: project.lead.status,
      notes: project.lead.notes,
      inReview: project.lead.inReview,
      contact: project.lead.contact ? {
        id: project.lead.contact.id,
        name: project.lead.contact.name,
        phone: project.lead.contact.phone,
        email: project.lead.contact.email,
        occupation: project.lead.contact.occupation,
        address: project.lead.contact.address,
        addressLink: project.lead.contact.addressLink,
        isCustomer: project.lead.contact.customer,
        isClient: project.lead.contact.client,
        company: project.lead.contact.company ? {
          id: project.lead.contact.company.id,
          name: project.lead.contact.company.name,
          address: project.lead.contact.company.address,
          type: project.lead.contact.company.type,
          serviceId: project.lead.contact.company.serviceId,
          isCustomer: project.lead.contact.company.customer,
          isClient: project.lead.contact.company.client,
        } : null,
      } : null,
      projectType: project.lead.projectType ? {
        id: project.lead.projectType.id,
        name: project.lead.projectType.name,
      } : null,
    } : null;

    const dto = {
      ...projectDto,
      lead: leadDto,
    };

    await this.qboEnrichment.enrichProjectFullProfile(dto);

    return dto;
  }

  async findByStatus(status: ProjectProgressStatus): Promise<any[]> {
    const entities = await this.projectRepo.find({
      where: { projectProgressStatus: status },
      relations: ['lead', 'lead.contact', 'lead.contact.company', 'lead.projectType'],
    });
    return entities.map((entity) => this.projectMapper.toDto(entity));
  }

  async getStatusCounts(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; count: number }>> {
    return this.projectsRepository.getStatusCounts(leadType);
  }

  async findAnalyticsProjectSeed(
    limit: number = 200,
    leadType?: LeadType,
  ): Promise<
    Array<{
      id: number;
      projectProgressStatus?: ProjectProgressStatus;
      leadNumber?: string;
      leadName?: string;
    }>
  > {
    return this.projectsRepository.findAnalyticsProjectSeed(limit, leadType);
  }

  async countAll(leadType?: LeadType): Promise<number> {
    return this.projectsRepository.countAll(leadType);
  }

  async findByContactId(contactId: number): Promise<any[]> {
    const entities = await this.projectRepo
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.lead', 'lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .where('contact.id = :contactId', { contactId })
      .getMany();
    return entities.map((entity) => this.projectMapper.toDto(entity));
  }

  async findByLeadNumber(leadNumber: string): Promise<any> {
    const startTime = Date.now();

    const entity = await this.projectsRepository.findByLeadNumber(leadNumber);
    if (!entity) {
      throw new ResourceNotFoundException(
        `Project not found with leadNumber: ${leadNumber}`,
      );
    }

    const dto = this.projectMapper.toDto(entity);
    await this.qboEnrichment.enrichProjectSummary(dto);

    const duration = Date.now() - startTime;
    this.logger.log(`Project findByLeadNumber ${leadNumber} completed in ${duration}ms`);

    return dto;
  }

  async delete(id: number): Promise<void> {
    const project = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead'],
    });
    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }
    const leadId = project.lead?.id;
    await this.projectRepo.delete(id);
    this.logger.log(`Project ${id} deleted`);

    if (leadId) {
      try {
        await this.leadRepo.delete(leadId);
        this.logger.log(`Lead ${leadId} deleted alongside project ${id}`);
      } catch (err) {
        this.logger.warn(`Failed to delete lead ${leadId} after project ${id} deletion: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async revertToLead(id: number): Promise<{ leadId: number }> {
    const project = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead'],
    });
    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }
    const lead = project.lead;
    if (!lead) {
      throw ValidationException.format(
        'Project %s has no associated lead to revert to',
        id.toString(),
      );
    }

    await this.projectRepo.delete(id);
    this.logger.log(`Project ${id} deleted as part of revert-to-lead`);

    lead.status = LeadStatus.FOLLOW_UP;
    await this.leadRepo.save(lead);
    this.logger.log(`Lead ${lead.id} status reset to FOLLOW_UP after revert`);

    return { leadId: lead.id };
  }

  async findEstimateFile(
    id: number,
  ): Promise<{ found: true; key: string; fileName: string } | { found: false }> {
    const project = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead'],
    });
    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    const keys = Array.from(
      new Set([
        ...(project.attachments ?? []),
        ...(project.lead?.attachments ?? []),
      ]),
    );

    const match = keys.find((key) =>
      /estimate/i.test(this.extractFileName(key)),
    );

    if (!match) {
      return { found: false };
    }

    return { found: true, key: match, fileName: this.extractFileName(match) };
  }

  private extractFileName(key: string): string {
    const segments = key.split('/');
    return segments[segments.length - 1] || key;
  }

  async sendEstimateEmail(
    id: number,
    dto: SendEstimateEmailDto,
  ): Promise<
    | { sent: true; attached: boolean; recipients: string[] }
    | { sent: false; reason: 'ESTIMATE_NOT_FOUND' }
  > {
    const project = await this.projectRepo.findOne({
      where: { id },
      relations: ['lead'],
    });
    if (!project) {
      throw new ResourceNotFoundException(`Project not found with id: ${id}`);
    }

    const providedRecipients = this.dedupeLowercase(dto.recipients ?? []);
    if (providedRecipients.length === 0) {
      throw ValidationException.format(
        'At least one recipient email is required',
      );
    }
    const recipients = providedRecipients;
    const recipientSet = new Set(recipients);
    const ccValues = this.dedupeLowercase(dto.cc ?? []).filter(
      (email) => !recipientSet.has(email),
    );
    const cc = ccValues.length > 0 ? ccValues : undefined;

    let attached = false;
    let attachments:
      | { filename: string; content: Buffer; contentType?: string }[]
      | undefined;

    if (dto.includeAttachment) {
      let key = dto.attachmentKey;
      if (!key) {
        const found = await this.findEstimateFile(id);
        if (found.found) {
          key = found.key;
        }
      }
      if (!key) {
        return { sent: false, reason: 'ESTIMATE_NOT_FOUND' };
      }
      const file = await this.s3Service.getObjectBuffer(key);
      attachments = [
        {
          filename: file.fileName,
          content: file.buffer,
          contentType: file.contentType ?? undefined,
        },
      ];
      attached = true;
    }

    const leadNumber = project.lead?.leadNumber;
    const leadName = project.lead?.name;
    const subject =
      dto.subject ??
      `Estimate for ${leadNumber ?? leadName ?? `project ${id}`}`;
    const text =
      dto.message ??
      `Please find the estimate for ${leadName ?? leadNumber ?? `project ${id}`}.`;

    await this.mailService.sendMail({
      to: recipients,
      cc,
      subject,
      text,
      attachments,
    });

    return { sent: true, attached, recipients };
  }

  private dedupeLowercase(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    );
  }
}
