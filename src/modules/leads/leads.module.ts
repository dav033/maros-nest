import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../../entities/lead.entity';
import { Contact } from '../../entities/contact.entity';
import { ProjectType } from '../../entities/project-type.entity';
import { Project } from '../../entities/project.entity';
import { LeadsRepository } from './lead-management/repositories/leads.repository';
import { LeadsService } from './lead-management/leads.service';
import { LeadClickUpSyncService } from './clickup-sync/lead-clickup-sync.service';
import { LeadsController } from './lead-management/leads.controller';
import { LeadMapper } from './lead-management/mappers/lead.mapper';
import { LeadNumberingService } from './lead-management/services/lead-numbering.service';
import { LeadMutationService } from './lead-management/services/lead-mutation.service';
import { ContactsModule } from '../contacts/contacts.module';
import { ClickUpModule } from '../clickup/clickup.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Contact, ProjectType, Project]),
    ContactsModule,
    ClickUpModule,
  ],
  controllers: [LeadsController],
  providers: [
    LeadsRepository,
    LeadsService,
    LeadMapper,
    LeadClickUpSyncService,
    LeadNumberingService,
    LeadMutationService,
  ],
  exports: [LeadsRepository, LeadsService],
})
export class LeadsModule {}
