import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../../entities/contact.entity';

@Injectable()
export class ContactInfoFormatter {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  async formatFor(contactId: number): Promise<string> {
    if (!contactId) {
      return '';
    }

    const contact = await this.contactRepository.findOne({
      where: { id: contactId },
    });

    if (!contact) {
      return '';
    }

    return [
      `- **Contact Name:** ${contact.name}`,
      `- **Phone:** ${contact.phone || 'N/A'}`,
      `- **Email:** ${contact.email || 'N/A'}`,
    ].join('\n');
  }
}
