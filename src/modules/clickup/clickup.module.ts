import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClickUpService } from './services/clickup.service';
import { ClickUpRoutingService } from './services/clickup-routing.service';
import { LeadClickUpMapping } from '../../entities/lead-clickup-mapping.entity';
import { LeadClickUpMappingRepository } from './repositories/lead-clickup-mapping.repository';
import clickupConfig from '../../config/clickup.config';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forFeature(clickupConfig),
    TypeOrmModule.forFeature([LeadClickUpMapping]),
  ],
  providers: [
    ClickUpService,
    ClickUpRoutingService,
    LeadClickUpMappingRepository,
  ],
  exports: [
    ClickUpService,
    ClickUpRoutingService,
  ],
})
export class ClickUpModule {}
