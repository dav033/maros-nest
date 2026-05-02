import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QboConnection } from './entities/qbo-connection.entity';
import { Company } from '../entities/company.entity';
import { TokenCryptoService } from './services/token-crypto.service';
import { QuickbooksAuthService } from './services/quickbooks-auth.service';
import { QuickbooksApiService } from './services/quickbooks-api.service';
import { QuickbooksFinancialsService } from './services/quickbooks-financials.service';
import { QuickbooksReportsService } from './services/quickbooks-reports.service';
import { QuickbooksTokenRefreshCron } from './cron/quickbooks-token-refresh.cron';
import { QuickbooksNormalizerService } from './services/quickbooks-normalizer.service';
import { QuickbooksJobCostingService } from './services/quickbooks-job-costing.service';
import { QuickbooksAttachmentsService } from './services/quickbooks-attachments.service';
import { QuickbooksVendorMatchingService } from './services/quickbooks-vendor-matching.service';
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
    QuickbooksReportsService,
    QuickbooksNormalizerService,
    QuickbooksAttachmentsService,
    QuickbooksVendorMatchingService,
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
