import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Company } from '../../../entities/company.entity';
import { Contact } from '../../../entities/contact.entity';
import { LeadsService } from '../../leads/lead-management/leads.service';
import {
  LeadIntakeRequestDto,
  LeadIntakeResponseDto,
} from './dto/lead-intake-request.dto';
import { LeadType } from '../../../common/enums/lead-type.enum';

@Injectable()
export class LeadIntakeService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    private readonly leadsService: LeadsService,
  ) {}

  async processLeadIntake(
    dto: LeadIntakeRequestDto,
  ): Promise<LeadIntakeResponseDto> {
    const actions: string[] = [];
    let company: Company | null = null;
    let contact: Contact | null = null;
    // Whether this lead came from somebody already in the CRM. Tracked as a flag rather
    // than recovered from `actions` afterwards, because those strings are a human-readable
    // log and matching on them would make the channel depend on their wording.
    let knownParty = false;

    if (dto.companyId) {
      company = await this.companyRepo.findOne({
        where: { id: dto.companyId },
      });
      if (company) {
        actions.push(`Found existing company by ID: ${company.id}`);
        knownParty = true;
      }
    }

    if (!company && dto.companyName) {
      company = await this.companyRepo.findOne({
        where: { name: ILike(`%${dto.companyName}%`) },
      });
      if (company) {
        actions.push(`Found existing company by name: ${company.name}`);
        knownParty = true;
      }
    }

    if (!company && dto.companyEmail) {
      company = await this.companyRepo.findOne({
        where: { email: ILike(`%${dto.companyEmail}%`) },
      });
      if (company) {
        actions.push(`Found existing company by email: ${company.email}`);
        knownParty = true;
      }
    }

    if (!company && (dto.companyName || dto.companyEmail)) {
      const newCompany = this.companyRepo.create({
        name: dto.companyName || 'Unknown Company',
        email: dto.companyEmail || undefined,
        address: dto.companyAddress || undefined,
      });
      company = await this.companyRepo.save(newCompany);
      actions.push(`Created new company: ${company.name} (ID: ${company.id})`);
    }

    if (dto.contactId) {
      contact = await this.contactRepo.findOne({
        where: { id: dto.contactId },
        relations: ['company'],
      });
      if (contact) {
        actions.push(`Found existing contact by ID: ${contact.id}`);
        knownParty = true;
      }
    }

    if (!contact && dto.contactEmail) {
      contact = await this.contactRepo.findOne({
        where: { email: ILike(dto.contactEmail) },
        relations: ['company'],
      });
      if (contact) {
        actions.push(`Found existing contact by email: ${contact.email}`);
        knownParty = true;
      }
    }

    if (!contact && (dto.contactName || dto.contactEmail)) {
      const newContact = this.contactRepo.create({
        name: dto.contactName || 'Unknown Contact',
        email: dto.contactEmail || undefined,
        company: company || undefined,
      });
      contact = await this.contactRepo.save(newContact);
      actions.push(`Created new contact: ${contact.name} (ID: ${contact.id})`);
    }

    if (contact && company && !contact.company) {
      contact.company = company;
      await this.contactRepo.save(contact);
      actions.push(
        `Associated contact ${contact.id} with company ${company.id}`,
      );
    } else if (
      contact &&
      company &&
      contact.company &&
      contact.company.id !== company.id
    ) {
      actions.push(
        `Contact ${contact.id} already associated with company ${contact.company.id}, keeping existing association`,
      );
    }

    if (!contact) {
      throw new Error(
        'Cannot create lead without a contact. Provide contactId, contactEmail, or contactName.',
      );
    }

    const leadType = dto.leadType || LeadType.CONSTRUCTION;

    /**
     * The channel, recorded here because this is the only place that can know it.
     *
     * A declared source wins: the caller knows whether it is a website form or a partner
     * feed, and this service cannot tell those apart. Absent one, an existing contact or
     * company means `repeat_client` — the lookups above already established that, and
     * repeat business was 36% of the pipeline with nothing recording it.
     *
     * Nothing is invented when neither applies: a brand new party with no declared channel
     * leaves `source` NULL. Defaulting to `other` would bury "we never asked" inside a
     * bucket that is supposed to mean "asked, and it was none of the above".
     */
    const source = dto.source ?? (knownParty ? 'repeat_client' : undefined);

    const lead = await this.leadsService.createLeadWithExistingContact(
      {
        location: dto.leadLocation,
        projectTypeId: dto.projectTypeId,
        inReview: true,
        source,
      },
      contact.id,
      leadType,
    );
    actions.push(`Created lead in review: ${lead.leadNumber} (ID: ${lead.id})`);

    const finalContact = await this.contactRepo.findOne({
      where: { id: contact.id },
      relations: ['company'],
    });

    return {
      lead,
      company: company
        ? {
            id: company.id,
            name: company.name,
            email: company.email,
            address: company.address,
          }
        : null,
      contact: finalContact
        ? {
            id: finalContact.id,
            name: finalContact.name,
            email: finalContact.email,
            companyId: finalContact.company?.id || null,
          }
        : null,
      actions,
    };
  }
}
