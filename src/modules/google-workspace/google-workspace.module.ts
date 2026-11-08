import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { InvoiceScan } from '../quickbooks/entities/invoice-scan.entity';
import { S3Module } from '../s3/s3.module';
import { AttachmentSourceService } from './attachment-source.service';
import { DriveFilesService } from './drive-files.service';
import { GmailDraftsService } from './gmail-drafts.service';
import { GmailInvoiceImportService } from './gmail-invoice-import.service';
import { GmailLabelsService } from './gmail-labels.service';
import { GoogleWorkspaceAuthService } from './google-workspace-auth.service';
import { GoogleWorkspaceService } from './google-workspace.service';

@Module({
  imports: [GoogleCalendarModule, QuickbooksModule, S3Module, TypeOrmModule.forFeature([InvoiceScan])],
  providers: [
    GoogleWorkspaceAuthService,
    GmailDraftsService,
    GmailInvoiceImportService,
    GmailLabelsService,
    DriveFilesService,
    AttachmentSourceService,
    GoogleWorkspaceService,
  ],
  exports: [GoogleWorkspaceService],
})
export class GoogleWorkspaceModule {}
