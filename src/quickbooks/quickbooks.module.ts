import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QboConnection } from './entities/qbo-connection.entity';
import { TokenCryptoService } from './services/token-crypto.service';
import { QuickbooksAuthService } from './services/quickbooks-auth.service';
import { QuickbooksApiService } from './services/quickbooks-api.service';
import { QuickbooksFinancialsService } from './services/quickbooks-financials.service';
import { QuickbooksTokenRefreshCron } from './cron/quickbooks-token-refresh.cron';
import { QuickbooksController } from './quickbooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([QboConnection]),
    HttpModule,
  ],
  controllers: [QuickbooksController],
  providers: [
    TokenCryptoService,
    QuickbooksAuthService,
    QuickbooksApiService,
    QuickbooksFinancialsService,
    QuickbooksTokenRefreshCron,
  ],
  exports: [QuickbooksAuthService, QuickbooksApiService, QuickbooksFinancialsService],
})
export class QuickbooksModule {}
