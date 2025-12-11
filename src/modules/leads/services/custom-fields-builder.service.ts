import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../../entities/contact.entity';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { ClickUpCustomFieldDto } from '../../clickup/dto/clickup-task-request.dto';
import { ClickUpRoutingService } from '../../clickup/services/clickup-routing.service';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { getLeadTypeFromNumber } from '../../../common/utils/lead-type.utils';

@Injectable()
export class CustomFieldsBuilder {
  private readonly logger = new Logger(CustomFieldsBuilder.name);

  constructor(
    private readonly routingService: ClickUpRoutingService,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  async build(dto: CreateLeadDto): Promise<ClickUpCustomFieldDto[]> {
    const fields: ClickUpCustomFieldDto[] = [];

    const type = getLeadTypeFromNumber(dto.leadNumber) || LeadType.CONSTRUCTION;
    const number = dto.leadNumber;
    
    const route = this.routingService.route(type);
    const f = route.fields;
    const leadNumberFieldId = this.routingService.resolveLeadNumberFieldId(type);

    if (!number) {
      throw new Error(`LeadNumber empty when creating task (leadType=${type})`);
    }
    if (!leadNumberFieldId) {
      throw new Error(`Could not resolve leadNumberId for ${type}`);
    }

    fields.push({ id: leadNumberFieldId, value: number });
    this.logger.debug(`FIELD -> ${leadNumberFieldId} = ${number} (leadNumber)`);

    let contact: Contact | null = null;
    if (dto.contactId) {
      try {
        contact = await this.contactRepository.findOne({ where: { id: dto.contactId } });
      } catch (e) {
        // Ignore error
      }
    }

    const contactName = contact?.name || '';
    const contactEmail = contact?.email || '';
    const contactPhone = contact?.phone || '';

    this.addField(fields, f.contactNameId, contactName, true);
    this.addField(fields, f.customerNameId, contactName, true);
    this.addField(fields, f.emailId, contactEmail, true);

    const formattedPhone = this.formatPhoneForClickUp(contactPhone);
    this.addField(fields, f.phoneId, formattedPhone, true);
    this.addField(fields, f.phoneTextId, contactPhone, true);

    const addr = dto.location;
    const addrTextId = f.locationTextId;
    const locationId = f.locationId;

    if (locationId) {
      let locationValue: any = null;
      if (addr && addr.trim() !== '') {
        locationValue = { address: addr.trim() };
      }
      this.addField(fields, locationId, locationValue, true);
    }
    this.addField(fields, addrTextId, addr, true);

    return fields;
  }

  private addField(out: ClickUpCustomFieldDto[], fieldId: string | undefined, value: any, clearIfMissing: boolean) {
    if (!fieldId) return;

    if (value === null || value === undefined) {
      if (clearIfMissing) {
        out.push({ id: fieldId, value: null });
      }
      return;
    }

    if (typeof value === 'string') {
      if (value.trim() === '') {
        if (clearIfMissing) {
          out.push({ id: fieldId, value: null });
        }
        return;
      }
      out.push({ id: fieldId, value: value.trim() });
    } else {
      out.push({ id: fieldId, value: value });
    }
  }

  private formatPhoneForClickUp(phone: string): string | null {
    if (!phone || phone.trim() === '') {
      return null;
    }

    const cleaned = phone.replace(/[\s\-().]+/g, '');

    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    if (cleaned.startsWith('1') && cleaned.length === 11) {
      return '+' + cleaned;
    }

    if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
      return '+1' + cleaned;
    }

    if (/^\d+$/.test(cleaned)) {
      return '+1' + cleaned;
    }

    this.logger.warn(`Invalid phone format for ClickUp: '${phone}'. Sending as null.`);
    return null;
  }
}
