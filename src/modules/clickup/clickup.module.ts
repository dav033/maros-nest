import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ClickUpService } from './services/clickup.service';
import { ClickUpRoutingService } from './services/clickup-routing.service';
import clickupConfig from '../../config/clickup.config';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forFeature(clickupConfig),
  ],
  providers: [
    ClickUpService,
    ClickUpRoutingService,
  ],
  exports: [
    ClickUpService,
    ClickUpRoutingService,
  ],
})
export class ClickUpModule {}
