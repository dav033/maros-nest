import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmController } from './crm.controller';
import { LeadIntakeService } from './services/lead-intake.service';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesModule } from '../companies/companies.module';
import { LeadsModule } from '../leads/leads.module';
import { Company } from '../../entities/company.entity';
import { Contact } from '../../entities/contact.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, Contact]),
    ContactsModule,
    CompaniesModule,
    LeadsModule,
  ],
  controllers: [CrmController],
  providers: [LeadIntakeService],
})
export class CrmModule {}
