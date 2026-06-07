import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import mailConfig from '../../config/mail.config';
import { MailService } from './services/mail.service';

@Module({
  imports: [ConfigModule.forFeature(mailConfig)],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
