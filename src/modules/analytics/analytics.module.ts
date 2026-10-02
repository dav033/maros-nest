import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../../entities/lead.entity';
import { LeadsModule } from '../leads/leads.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsClientsService } from './services/analytics-clients.service';
import { AnalyticsFinancialService } from './services/analytics-financial.service';
import { AnalyticsOverviewService } from './services/analytics-overview.service';
import { AnalyticsPipelineService } from './services/analytics-pipeline.service';
import { AnalyticsProjectsService } from './services/analytics-projects.service';
import { AnalyticsStaleLeadsService } from './services/analytics-stale-leads.service';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300_000,
      max: 200,
    }),
    // The two client/lead views read the leads table directly; everything else in here
    // goes through LeadsModule and ProjectsModule.
    TypeOrmModule.forFeature([Lead]),
    LeadsModule,
    ProjectsModule,
    QuickbooksModule,
  ],
  controllers: [AnalyticsController],
  exports: [
    AnalyticsOverviewService,
    AnalyticsPipelineService,
    AnalyticsFinancialService,
    AnalyticsProjectsService,
    AnalyticsClientsService,
    AnalyticsStaleLeadsService,
  ],
  providers: [
    AnalyticsOverviewService,
    AnalyticsPipelineService,
    AnalyticsFinancialService,
    AnalyticsProjectsService,
    AnalyticsClientsService,
    AnalyticsStaleLeadsService,
  ],
})
export class AnalyticsModule {}
