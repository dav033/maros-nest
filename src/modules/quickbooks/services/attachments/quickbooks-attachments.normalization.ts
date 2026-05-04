import { QboAiWarning, QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import {
  QboAttachmentEntityRef,
  QboAttachmentOptions,
  QboNormalizedAttachment,
} from './quickbooks-attachments.types';
import { QuickbooksAttachmentsHelpers } from './quickbooks-attachments.helpers';
import { QuickbooksAttachmentsQueryService } from './quickbooks-attachments.query';

export class QuickbooksAttachmentsNormalizationService {
  constructor(
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly queryService: QuickbooksAttachmentsQueryService,
    private readonly helpers: QuickbooksAttachmentsHelpers,
  ) {}

  async normalizeAttachmentsForEntity(
    realmId: string,
    entityRef: QboAttachmentEntityRef,
    attachments: Record<string, unknown>[],
    options: QboAttachmentOptions,
    warnings: QboAiWarning[],
  ): Promise<QboNormalizedAttachment[]> {
    const result: QboNormalizedAttachment[] = [];
    for (const raw of attachments) {
      const linkedRefs = this.helpers.extractAttachableRefs(raw).filter(
        (ref) =>
          ref.entityType === entityRef.entityType &&
          ref.entityId === entityRef.entityId,
      );
      const refs = linkedRefs.length ? linkedRefs : [entityRef];

      for (const ref of refs) {
        result.push(
          await this.normalizeAttachment(realmId, raw, ref, options, warnings),
        );
      }
    }
    return result;
  }

  private async normalizeAttachment(
    realmId: string,
    raw: Record<string, unknown>,
    entityRef: QboAttachmentEntityRef,
    options: QboAttachmentOptions,
    warnings: QboAiWarning[],
  ): Promise<QboNormalizedAttachment> {
    const attachmentId = this.helpers.stringValue(raw['Id']);
    const fileName = this.helpers.stringValue(raw['FileName']);
    const tempDownloadUrlFromRaw = this.helpers.stringValue(raw['TempDownloadUri']);
    const includeTempDownloadUrl = options.includeTempDownloadUrl === true;
    let tempDownloadUrl = '';
    let downloadUrlFetchedAt: string | undefined;

    if (!fileName) {
      warnings.push(
        this.normalizer.warning(
          'attachment_without_file_name',
          `Attachment ${attachmentId || '(unknown)'} has no file name.`,
        ),
      );
    }

    if (includeTempDownloadUrl) {
      if (tempDownloadUrlFromRaw) {
        tempDownloadUrl = tempDownloadUrlFromRaw;
        downloadUrlFetchedAt = new Date().toISOString();
      } else if (attachmentId) {
        const download = await this.queryService.getAttachmentDownloadUrl(
          realmId,
          attachmentId,
        );
        tempDownloadUrl = download.tempDownloadUrl;
        downloadUrlFetchedAt = download.downloadUrlFetchedAt;
        warnings.push(...download.warnings);
      }
    } else if (fileName || tempDownloadUrlFromRaw) {
      warnings.push(
        this.normalizer.warning(
          'attachment_download_url_not_requested',
          `Temporary download URL for attachment ${attachmentId || '(unknown)'} was not requested.`,
        ),
      );
    }

    const metadata = this.helpers.asRecord(raw['MetaData']);
    const normalized: QboNormalizedAttachment = {
      attachmentId,
      fileName,
      contentType: this.helpers.stringValue(raw['ContentType']),
      size: raw['Size'] == null ? null : this.helpers.numberValue(raw['Size']),
      note: this.helpers.stringValue(raw['Note']),
      createdAt: this.helpers.stringValue(metadata['CreateTime']),
      updatedAt: this.helpers.stringValue(metadata['LastUpdatedTime']),
      linkedEntityType: entityRef.entityType,
      linkedEntityId: entityRef.entityId,
      includeOnSend: this.helpers.includeOnSend(raw, entityRef),
      hasDownloadUrl: !!(fileName || tempDownloadUrlFromRaw || tempDownloadUrl),
      downloadUrlExpires: null,
    };

    if (includeTempDownloadUrl && downloadUrlFetchedAt) {
      normalized.downloadUrlFetchedAt = downloadUrlFetchedAt;
    }
    if (includeTempDownloadUrl && tempDownloadUrl) {
      normalized.tempDownloadUrl = tempDownloadUrl;
    }

    return normalized;
  }
}
