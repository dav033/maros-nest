import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import s3Config from '../../config/s3.config';
import { S3UploadController } from './s3-upload.controller';
import { S3Service } from './services/s3.service';

@Module({
  imports: [ConfigModule.forFeature(s3Config)],
  controllers: [S3UploadController],
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
