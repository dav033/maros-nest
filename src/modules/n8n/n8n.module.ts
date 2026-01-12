import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { N8nService } from './services/n8n.service';
import n8nConfig from '../../config/n8n.config';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forFeature(n8nConfig),
  ],
  providers: [N8nService],
  exports: [N8nService],
})
export class N8nModule {}






