import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinstonModule } from 'nest-winston';
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

@Module({
  imports: [
    // Configuration Module - Load environment variables
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigService available globally
      envFilePath: ['.env.local', '.env'], // Load .env files
      validate, // Validate environment variables on startup
      load: [clickupConfig, n8nConfig], // Load ClickUp and N8N configuration
    }),

    // Winston Logger Module
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
