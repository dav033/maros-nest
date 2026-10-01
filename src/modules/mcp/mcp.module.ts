import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { CompaniesModule } from '../companies/companies.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { S3Module } from '../s3/s3.module';
import { TrelloModule } from '../trello/trello.module';
import { NotesModule } from '../notes/notes.module';
import { TasksModule } from '../tasks/tasks.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ManagedFilesModule } from '../managed-files/managed-files.module';
import { ReportsModule } from '../reports/reports.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './guards/mcp-auth.guard';
import { McpActorService } from './mcp-actor.service';

@Module({
  imports: [
    LeadsModule,
    CompaniesModule,
    ContactsModule,
    ProjectsModule,
    QuickbooksModule,
    S3Module,
    TrelloModule,
    NotesModule,
    TasksModule,
    AnalyticsModule,
    NotificationsModule,
    ManagedFilesModule,
    ReportsModule,
  ],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard, McpActorService],
})
export class McpModule {}
