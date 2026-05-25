import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsFinancialService } from './services/analytics-financial.service';
import { AnalyticsOverviewService } from './services/analytics-overview.service';
import { AnalyticsPipelineService } from './services/analytics-pipeline.service';
import { AnalyticsProjectsService } from './services/analytics-projects.service';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300_000,
      max: 200,
    }),
    LeadsModule,
    ProjectsModule,
    QuickbooksModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsOverviewService,
    AnalyticsPipelineService,
    AnalyticsFinancialService,
    AnalyticsProjectsService,
  ],
})
export class AnalyticsModule {}
