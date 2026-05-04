import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  QboAttachmentDownloadUrl,
  QboAttachmentEntityRef,
} from './quickbooks-attachments.types';
import { QuickbooksAttachmentsHelpers } from './quickbooks-attachments.helpers';
import {
  QboAiWarning,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';

export class QuickbooksAttachmentsQueryService {
  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly helpers: QuickbooksAttachmentsHelpers,
  ) {}

  async queryAttachablesByRef(
    realmId: string,
    ref: QboAttachmentEntityRef,
  ): Promise<Record<string, unknown>[]> {
    const entityType = this.apiService.escapeQboString(ref.entityType);
    const entityId = this.apiService.escapeQboString(ref.entityId);
    const rows = await this.apiService.queryAll(realmId, 'Attachable', {
      where:
        `AttachableRef.EntityRef.Type = '${entityType}' ` +
        `AND AttachableRef.EntityRef.Value = '${entityId}'`,
    });
    return rows.map((row) => this.helpers.asRecord(row));
  }

  async queryAttachablesByFallback(
    realmId: string,
    ref: QboAttachmentEntityRef,
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.apiService.queryAll(realmId, 'Attachable');
    return rows
      .map((row) => this.helpers.asRecord(row))
      .filter((attachment) => this.helpers.attachmentLinksToEntity(attachment, ref));
  }

  async getAttachmentDownloadUrl(
    realmId: string,
    attachableId: string,
  ): Promise<QboAttachmentDownloadUrl> {
    const raw = await this.apiService.getById(realmId, 'attachable', attachableId);
    const attachable = this.apiService.unwrapQboEntity(raw, 'Attachable');
    const tempDownloadUrl = this.helpers.stringValue(attachable['TempDownloadUri']);
    const warnings: QboAiWarning[] = [];

    if (!tempDownloadUrl) {
      warnings.push(
        this.normalizer.warning(
          'attachment_download_url_not_requested',
          `QuickBooks did not return a temporary download URL for attachment ${attachableId}.`,
        ),
      );
    }

    return {
      attachmentId: attachableId,
      tempDownloadUrl,
      downloadUrlFetchedAt: new Date().toISOString(),
      downloadUrlExpires: null,
      warnings,
    };
  }
}
