import { Injectable } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  QboAiWarning,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';
import { QuickbooksFinancialsService } from '../financials/quickbooks-financials.service';
import { resolveRealmIdOrDefault } from '../core/quickbooks-realm.utils';
import { QuickbooksAttachmentsHelpers } from './quickbooks-attachments.helpers';
import { QuickbooksAttachmentsNormalizationService } from './quickbooks-attachments.normalization';
import { QuickbooksAttachmentsProjectService } from './quickbooks-attachments.project';
import { QuickbooksAttachmentsQueryService } from './quickbooks-attachments.query';
import {
  QboAttachmentDownloadUrl,
  QboAttachmentEntityRef,
  QboAttachmentLookupResult,
  QboAttachmentOptions,
  QboAttachmentsForEntitiesResult,
  QboProjectAttachmentsParams,
  QboProjectAttachmentsResult,
} from './quickbooks-attachments.types';

export type {
  QboAttachmentDownloadUrl,
  QboAttachmentEntityRef,
  QboAttachmentEntityResult,
  QboAttachmentLookupResult,
  QboAttachmentOptions,
  QboAttachmentsForEntitiesResult,
  QboCustomerRecord,
  QboNormalizedAttachment,
  QboProjectAttachmentRef,
  QboProjectAttachmentsParams,
  QboProjectAttachmentsResult,
  ProjectAttachmentEntity,
} from './quickbooks-attachments.types';

@Injectable()
export class QuickbooksAttachmentsService {
  private readonly helpers: QuickbooksAttachmentsHelpers;
  private readonly queryService: QuickbooksAttachmentsQueryService;
  private readonly normalizationService: QuickbooksAttachmentsNormalizationService;
  private readonly projectService: QuickbooksAttachmentsProjectService;

  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly financials: QuickbooksFinancialsService,
  ) {
    this.helpers = new QuickbooksAttachmentsHelpers();
    this.queryService = new QuickbooksAttachmentsQueryService(
      this.apiService,
      this.normalizer,
      this.helpers,
    );
    this.normalizationService = new QuickbooksAttachmentsNormalizationService(
      this.normalizer,
      this.queryService,
      this.helpers,
    );
    this.projectService = new QuickbooksAttachmentsProjectService(
      this.apiService,
      this.normalizer,
      this.helpers,
    );
  }

  async getAttachmentsForEntity(
    realmId: string,
    entityType: string,
    entityId: string,
    options: QboAttachmentOptions = {},
  ): Promise<QboAttachmentLookupResult> {
    const entityRef: QboAttachmentEntityRef = { entityType, entityId };
    let fallbackUsed = false;
    let rawAttachments: Record<string, unknown>[] = [];
    const warnings: QboAiWarning[] = [];

    try {
      rawAttachments = await this.queryService.queryAttachablesByRef(realmId, entityRef);
    } catch {
      fallbackUsed = true;
      warnings.push(
        this.normalizer.warning(
          'attachment_lookup_fallback_used',
          `AttachableRef filter failed for ${entityType} ${entityId}; used paginated Attachable scan with in-memory filtering.`,
        ),
      );
      rawAttachments = await this.queryService.queryAttachablesByFallback(
        realmId,
        entityRef,
      );
    }

    const attachments = await this.normalizationService.normalizeAttachmentsForEntity(
      realmId,
      entityRef,
      rawAttachments,
      options,
      warnings,
    );

    if (!attachments.length) {
      warnings.push(
        this.normalizer.warning(
          'transaction_without_attachment',
          `${entityType} ${entityId} has no QuickBooks attachment metadata.`,
        ),
      );
    }

    return {
      entityRef,
      attachments,
      warnings: this.normalizer.dedupeWarnings(warnings),
      fallbackUsed,
    };
  }

  async getAttachmentsForEntities(
    realmId: string,
    entityRefs: QboAttachmentEntityRef[],
    options: QboAttachmentOptions = {},
  ): Promise<QboAttachmentsForEntitiesResult> {
    const uniqueRefs = this.helpers.uniqueEntityRefs(entityRefs);
    const byEntity = await Promise.all(
      uniqueRefs.map((ref) =>
        this.getAttachmentsForEntity(realmId, ref.entityType, ref.entityId, options),
      ),
    );
    const attachments = byEntity.flatMap((entity) => entity.attachments);
    const warnings = this.normalizer.dedupeWarnings(
      byEntity.flatMap((entity) => entity.warnings),
    );

    return {
      attachments,
      byEntity,
      warnings,
      coverage: {
        entitiesChecked: uniqueRefs.length,
        attachmentsFound: attachments.length,
        fallbackUsed: byEntity.some((entity) => entity.fallbackUsed),
      },
    };
  }

  async getProjectAttachments(
    params: QboProjectAttachmentsParams,
  ): Promise<QboProjectAttachmentsResult> {
    const realmId = await this.resolveRealmId(params.realmId);
    const project = await this.projectService.findProjectRefs(realmId, params);
    const warnings: QboAiWarning[] = [];

    if (!this.helpers.hasProjectIdentity(project)) {
      warnings.push(
        this.normalizer.warning(
          'PROJECT_NOT_RESOLVED',
          'Provide projectNumber or qboCustomerId to collect project attachments.',
        ),
      );
      return {
        project,
        entityRefs: [],
        attachments: [],
        byEntity: [],
        warnings,
        coverage: {
          entitiesChecked: 0,
          attachmentsFound: 0,
          fallbackUsed: false,
        },
      };
    }

    const entityRefs = await this.projectService.getProjectRelatedEntityRefs(
      realmId,
      project,
      params,
    );
    const attachmentResult = await this.getAttachmentsForEntities(realmId, entityRefs, {
      includeTempDownloadUrl: params.includeTempDownloadUrl,
    });

    return {
      project,
      entityRefs,
      attachments: attachmentResult.attachments,
      byEntity: attachmentResult.byEntity,
      warnings: this.normalizer.dedupeWarnings([
        ...warnings,
        ...attachmentResult.warnings,
      ]),
      coverage: attachmentResult.coverage,
    };
  }

  async getAttachmentDownloadUrl(
    realmId: string,
    attachableId: string,
  ): Promise<QboAttachmentDownloadUrl> {
    return this.queryService.getAttachmentDownloadUrl(realmId, attachableId);
  }

  private async resolveRealmId(realmId?: string): Promise<string> {
    return resolveRealmIdOrDefault(realmId, () =>
      this.financials.getDefaultRealmId(),
    );
  }
}
