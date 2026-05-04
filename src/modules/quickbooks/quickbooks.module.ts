import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
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
import { QuickbooksController } from './quickbooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([QboConnection, Company]),
    HttpModule,
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
  ],
})
export class QuickbooksModule {}
