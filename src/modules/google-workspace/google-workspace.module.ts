import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { InvoiceScan } from '../quickbooks/entities/invoice-scan.entity';
import { S3Module } from '../s3/s3.module';
import { AttachmentSourceService } from './attachment-source.service';
import { DriveFilesService } from './drive-files.service';
import { GmailDraftsService } from './gmail-drafts.service';
import { GoogleWorkspaceAuthService } from './google-workspace-auth.service';
import { GoogleWorkspaceService } from './google-workspace.service';

@Module({
  imports: [GoogleCalendarModule, S3Module, TypeOrmModule.forFeature([InvoiceScan])],
  providers: [
    GoogleWorkspaceAuthService,
    GmailDraftsService,
    DriveFilesService,
    AttachmentSourceService,
    GoogleWorkspaceService,
  ],
  exports: [GoogleWorkspaceService],
})
export class GoogleWorkspaceModule {}
