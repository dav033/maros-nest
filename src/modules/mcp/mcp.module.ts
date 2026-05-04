import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { CompaniesModule } from '../companies/companies.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './guards/mcp-auth.guard';

@Module({
  imports: [LeadsModule, CompaniesModule, ContactsModule, ProjectsModule, QuickbooksModule],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard],
})
export class McpModule {}
