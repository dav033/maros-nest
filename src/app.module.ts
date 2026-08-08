import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinstonModule } from 'nest-winston';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { getDatabaseConfig } from './config/database.config';
import { getLoggerConfig } from './config/logger.config';
import { validate } from './config/env.validation';
import s3Config from './config/s3.config';
import trelloConfig from './config/trello.config';
import { CompaniesModule } from './modules/companies/companies.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { CrmModule } from './modules/crm/crm.module';
import { ReportsModule } from './modules/reports/reports.module';
import { McpModule } from './modules/mcp/mcp.module';
import { QuickbooksModule } from './modules/quickbooks/quickbooks.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotesModule } from './modules/notes/notes.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // Configuration must be first — other modules depend on ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate,
      load: [trelloConfig, s3Config],
    }),

    // Global scheduling (cron jobs) — after Config so providers can inject ConfigService
    ScheduleModule.forRoot(),

    // Global event bus — used by QuickbooksTokenRefreshCron to emit qbo.connection.broken
    EventEmitterModule.forRoot(),

    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return getLoggerConfig(
          configService.get('NODE_ENV') || 'development',
          configService.get('LOG_LEVEL') || 'info',
        );
      },
    }),

    // TypeORM Module - Database configuration
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getDatabaseConfig(configService),
    }),

    // Feature modules
    CompaniesModule,
    ContactsModule,
    LeadsModule,
    ProjectsModule,
    CrmModule,
    ReportsModule,
    McpModule,
    QuickbooksModule,
    AnalyticsModule,
    NotesModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: SessionAuthGuard populates request.user, which
    // PermissionsGuard then checks against the route's @RequirePermissions.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
