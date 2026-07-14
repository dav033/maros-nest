import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QboConnection } from './entities/qbo-connection.entity';
import { Company } from '../../entities/company.entity';
import { TokenCryptoService } from './services/core/token-crypto.service';
import { QuickbooksAuthService } from './services/core/quickbooks-auth.service';
import { QuickbooksApiService } from './services/core/quickbooks-api.service';
import { QuickbooksFinancialsService } from './services/financials/quickbooks-financials.service';
import { QuickbooksFinancialsContextService } from './services/financials/quickbooks-financials-context.service';
import { QuickbooksFinancialsAttachmentsService } from './services/financials/quickbooks-financials-attachments.service';
import { QuickbooksFinancialsProjectsService } from './services/financials/quickbooks-financials-projects.service';
import { QuickbooksFinancialsProfitLossService } from './services/financials/quickbooks-financials-profit-loss.service';
import { QuickbooksFinancialsProfileService } from './services/financials/quickbooks-financials-profile.service';
import { QuickbooksEstimateWriteService } from './services/financials/quickbooks-estimate-write.service';
import { QuickbooksReportsService } from './services/reports/quickbooks-reports.service';
import { QuickbooksReportsContextService } from './services/reports/quickbooks-reports.context.service';
import { QuickbooksReportsOperationalService } from './services/reports/quickbooks-reports-operational.service';
import { QuickbooksReportsFinancialService } from './services/reports/quickbooks-reports-financial.service';
import { QuickbooksReportsBundleService } from './services/reports/quickbooks-reports-bundle.service';
import { QuickbooksTokenRefreshCron } from './cron/quickbooks-token-refresh.cron';
import { QuickbooksNormalizerService } from './services/core/quickbooks-normalizer.service';
import { QuickbooksJobCostingService } from './services/job-costing/quickbooks-job-costing.service';
import { QuickbooksJobCostingProjectProfileService } from './services/job-costing/quickbooks-job-costing-profile.service';
import { QuickbooksAttachmentsService } from './services/attachments/quickbooks-attachments.service';
import { QuickbooksVendorMatchingService } from './services/vendor/quickbooks-vendor-matching.service';
import { ProjectQboEnrichmentService } from './services/crm-bridge/project-qbo-enrichment.service';
import { QuickbooksController } from './quickbooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([QboConnection, Company]),
    HttpModule,
    CacheModule.register({
      ttl: 300_000,
      max: 500,
    }),
  ],
  controllers: [QuickbooksController],
  providers: [
    TokenCryptoService,
    QuickbooksAuthService,
    QuickbooksApiService,
    QuickbooksFinancialsService,
    QuickbooksFinancialsContextService,
    QuickbooksFinancialsAttachmentsService,
    QuickbooksFinancialsProjectsService,
    QuickbooksFinancialsProfitLossService,
    QuickbooksFinancialsProfileService,
    QuickbooksEstimateWriteService,
    QuickbooksReportsService,
    QuickbooksReportsContextService,
    QuickbooksReportsOperationalService,
    QuickbooksReportsFinancialService,
    QuickbooksReportsBundleService,
    QuickbooksNormalizerService,
    QuickbooksAttachmentsService,
    QuickbooksVendorMatchingService,
    QuickbooksJobCostingProjectProfileService,
    QuickbooksJobCostingService,
    QuickbooksTokenRefreshCron,
    ProjectQboEnrichmentService,
  ],
  exports: [
    QuickbooksAuthService,
    QuickbooksApiService,
    QuickbooksFinancialsService,
    QuickbooksReportsService,
    QuickbooksNormalizerService,
    QuickbooksAttachmentsService,
    QuickbooksVendorMatchingService,
    QuickbooksJobCostingService,
    ProjectQboEnrichmentService,
  ],
})
export class QuickbooksModule {}
