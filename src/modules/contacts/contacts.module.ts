import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { ContactsRepository } from './contact-management/repositories/contacts.repository';
import { ContactsService } from './contact-management/services/contacts.service';
import { ContactsController } from './contact-management/contacts.controller';
import { ContactMapper } from './contact-management/mappers/contact.mapper';
import { ContactInfoFormatter } from './contact-management/services/contact-info-formatter.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Company, Lead, Project]),
  ],
  controllers: [ContactsController],
  providers: [ContactsRepository, ContactsService, ContactMapper, ContactInfoFormatter],
  exports: [ContactsService],
})
export class ContactsModule {}
