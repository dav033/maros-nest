import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [ContactsModule, CompaniesModule],
  controllers: [CrmController],
})
export class CrmModule {}
