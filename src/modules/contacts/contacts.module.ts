import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { ContactsRepository } from './repositories/contacts.repository';
import { ContactsService } from './services/contacts.service';
import { ContactsController } from './contacts.controller';
import { ContactMapper } from './mappers/contact.mapper';
import { ContactInfoFormatter } from './services/contact-info-formatter.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Company, Lead, Project]),
  ],
  controllers: [ContactsController],
  providers: [ContactsRepository, ContactsService, ContactMapper, ContactInfoFormatter],
  exports: [ContactsService],
})
export class ContactsModule {}
