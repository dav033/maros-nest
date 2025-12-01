import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../../entities/lead.entity';
import { Contact } from '../../entities/contact.entity';
import { ProjectType } from '../../entities/project-type.entity';
import { Project } from '../../entities/project.entity';
import { LeadsRepository } from './repositories/leads.repository';
import { LeadsService } from './services/leads.service';
import { LeadClickUpSyncService } from './services/lead-clickup-sync.service';
import { LeadsController } from './leads.controller';
import { LeadMapper } from './mappers/lead.mapper';
import { ContactsModule } from '../contacts/contacts.module';
import { ClickUpModule } from '../clickup/clickup.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Contact, ProjectType, Project]),
    ContactsModule,
    ClickUpModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsRepository, LeadsService, LeadMapper, LeadClickUpSyncService],
  exports: [LeadsRepository, LeadsService],
})
export class LeadsModule {}
