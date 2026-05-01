import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinstonModule } from 'nest-winston';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { getDatabaseConfig } from './config/database.config';
import { getLoggerConfig } from './config/logger.config';
import { validate } from './config/env.validation';
import clickupConfig from './config/clickup.config';
import n8nConfig from './config/n8n.config';
import { CompaniesModule } from './modules/companies/companies.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { CrmModule } from './modules/crm/crm.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuthModule } from './modules/auth/auth.module';
import { McpModule } from './modules/mcp/mcp.module';
import { QuickbooksModule } from './quickbooks/quickbooks.module';

@Module({
  imports: [
    // Configuration must be first — other modules depend on ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate,
      load: [clickupConfig, n8nConfig],
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
    AuthModule,
    CompaniesModule,
    ContactsModule,
    LeadsModule,
    ProjectsModule,
    CrmModule,
    ReportsModule,
    McpModule,
    QuickbooksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
