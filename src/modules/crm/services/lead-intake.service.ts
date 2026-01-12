import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Company } from '../../../entities/company.entity';
import { Contact } from '../../../entities/contact.entity';
import { LeadsService } from '../../leads/services/leads.service';
import { LeadIntakeRequestDto, LeadIntakeResponseDto } from '../dto/lead-intake-request.dto';
import { LeadType } from '../../../common/enums/lead-type.enum';

@Injectable()
export class LeadIntakeService {
  private readonly logger = new Logger(LeadIntakeService.name);

  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    private readonly leadsService: LeadsService,
  ) {}

  async processLeadIntake(dto: LeadIntakeRequestDto): Promise<LeadIntakeResponseDto> {
    const actions: string[] = [];
    let company: Company | null = null;
    let contact: Contact | null = null;

    // Step 1: Find or create company
    if (dto.companyId) {
      company = await this.companyRepo.findOne({ where: { id: dto.companyId } });
      if (company) {
        actions.push(`Found existing company by ID: ${company.id}`);
      }
    }

    if (!company && dto.companyName) {
      // Search by name (case insensitive)
      company = await this.companyRepo.findOne({
        where: { name: ILike(`%${dto.companyName}%`) },
      });
      if (company) {
        actions.push(`Found existing company by name: ${company.name}`);
      }
    }

    if (!company && dto.companyEmail) {
      // Search by email
      company = await this.companyRepo.findOne({
        where: [
          { email: ILike(`%${dto.companyEmail}%`) },
          { submiz: ILike(`%${dto.companyEmail}%`) },
        ],
      });
      if (company) {
        actions.push(`Found existing company by email: ${company.email || company.submiz}`);
      }
    }

    if (!company && (dto.companyName || dto.companyEmail)) {
      // Create new company
      const newCompany = this.companyRepo.create({
        name: dto.companyName || 'Unknown Company',
        email: dto.companyEmail || undefined,
        address: dto.companyAddress || undefined,
      });
      company = await this.companyRepo.save(newCompany);
      actions.push(`Created new company: ${company.name} (ID: ${company.id})`);
    }

    // Step 2: Find or create contact
    if (dto.contactId) {
      contact = await this.contactRepo.findOne({
        where: { id: dto.contactId },
        relations: ['company'],
      });
      if (contact) {
        actions.push(`Found existing contact by ID: ${contact.id}`);
      }
    }

    if (!contact && dto.contactEmail) {
      // Search by email (case insensitive)
      contact = await this.contactRepo.findOne({
        where: { email: ILike(dto.contactEmail) },
        relations: ['company'],
      });
      if (contact) {
        actions.push(`Found existing contact by email: ${contact.email}`);
      }
    }

    if (!contact && (dto.contactName || dto.contactEmail)) {
      // Create new contact
      const newContact = this.contactRepo.create({
        name: dto.contactName || 'Unknown Contact',
        email: dto.contactEmail || undefined,
        company: company || undefined,
      });
      contact = await this.contactRepo.save(newContact);
      actions.push(`Created new contact: ${contact.name} (ID: ${contact.id})`);
    }

    // Step 3: Associate contact with company if not already associated
    if (contact && company && !contact.company) {
      contact.company = company;
      await this.contactRepo.save(contact);
      actions.push(`Associated contact ${contact.id} with company ${company.id}`);
    } else if (contact && company && contact.company && contact.company.id !== company.id) {
      // Contact is associated with a different company - log but don't change
      actions.push(`Contact ${contact.id} already associated with company ${contact.company.id}, keeping existing association`);
    }

    // Step 4: Create lead with inReview = true
    if (!contact) {
      throw new Error('Cannot create lead without a contact. Provide contactId, contactEmail, or contactName.');
    }

    const leadType = dto.leadType || LeadType.CONSTRUCTION;
    
    const lead = await this.leadsService.createLeadWithExistingContact(
      {
        location: dto.leadLocation,
        projectTypeId: dto.projectTypeId,
        inReview: true,
      },
      contact.id,
      true, // skipClickUpSync for automated leads
      leadType,
    );
    actions.push(`Created lead in review: ${lead.leadNumber} (ID: ${lead.id})`);

    // Reload contact with company for response
    const finalContact = await this.contactRepo.findOne({
      where: { id: contact.id },
      relations: ['company'],
    });

    return {
      lead,
      company: company ? {
        id: company.id,
        name: company.name,
        email: company.email,
        address: company.address,
      } : null,
      contact: finalContact ? {
        id: finalContact.id,
        name: finalContact.name,
        email: finalContact.email,
        companyId: finalContact.company?.id || null,
      } : null,
      actions,
    };
  }
}
