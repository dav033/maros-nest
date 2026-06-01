import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { CompaniesModule } from '../companies/companies.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { S3Module } from '../s3/s3.module';
import { TrelloModule } from '../trello/trello.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './guards/mcp-auth.guard';

@Module({
  imports: [
    LeadsModule,
    CompaniesModule,
    ContactsModule,
    ProjectsModule,
    QuickbooksModule,
    S3Module,
    TrelloModule,
  ],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard],
})
export class McpModule {}
