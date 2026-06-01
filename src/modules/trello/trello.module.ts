import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import trelloConfig from '../../config/trello.config';
import { TrelloService } from './services/trello.service';

@Module({
  imports: [HttpModule, ConfigModule.forFeature(trelloConfig)],
  providers: [TrelloService],
  exports: [TrelloService],
})
export class TrelloModule {}
