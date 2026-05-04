import {
  QboAiWarning,
  QboNormalizedTransaction,
} from '../core/quickbooks-normalizer.service';
import {
  QboAttachmentEntityRef,
  QboNormalizedAttachment,
} from '../attachments/quickbooks-attachments.service';
import {
  AttachmentFetchResult,
  QboCostEntityType,
  QboJobCostTransaction,
  TransactionDescriptor,
} from './quickbooks-job-costing.types';

export type EnrichmentContext = {
  entityKey(entityType: string, entityId: string): string;
  normalizer: {
    warning(code: string, message: string): QboAiWarning;
    dedupeWarnings(warnings: QboAiWarning[]): QboAiWarning[];
  };
  attachmentsService: {
    getAttachmentsForEntities(
      realmId: string,
      refs: QboAttachmentEntityRef[],
      options: { includeTempDownloadUrl: boolean },
    ): Promise<{
      byEntity: Array<{
        entityRef: QboAttachmentEntityRef;
        attachments: QboNormalizedAttachment[];
        warnings: QboAiWarning[];
      }>;
      warnings: QboAiWarning[];
      coverage: {
        entitiesChecked: number;
        attachmentsFound: number;
        fallbackUsed: boolean;
      };
    }>;
  };
  normalizeWithAttachments(
    entityType: QboCostEntityType,
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[],
  ): QboNormalizedTransaction;
};

export async function fetchAttachmentsForDescriptorsEngine(
  ctx: EnrichmentContext,
  realmId: string,
  descriptors: TransactionDescriptor[],
  includeTempDownloadUrl: boolean,
): Promise<AttachmentFetchResult> {
  const refs = new Map<string, QboAttachmentEntityRef>();
  const descriptorRefs = new Map<string, string[]>();

  for (const descriptor of descriptors) {
    const entityId = descriptor.normalized.entityId;
    if (!entityId) continue;
    const descriptorKey = ctx.entityKey(descriptor.entityType, entityId);
    const directKey = descriptorKey;
    refs.set(directKey, {
      entityType: descriptor.entityType,
      entityId,
    });
    descriptorRefs.set(descriptorKey, [directKey]);

    for (const linked of descriptor.normalized.linkedTxn) {
      if (!linked.txnId || !linked.txnType) continue;
      const linkedKey = ctx.entityKey(linked.txnType, linked.txnId);
      refs.set(linkedKey, {
        entityType: linked.txnType,
        entityId: linked.txnId,
      });
      descriptorRefs.set(descriptorKey, [
        ...(descriptorRefs.get(descriptorKey) ?? []),
        linkedKey,
      ]);
    }
  }

  const attachmentResult = await ctx.attachmentsService.getAttachmentsForEntities(
    realmId,
    [...refs.values()],
    { includeTempDownloadUrl },
  );

  const attachmentsByRef = new Map<string, QboNormalizedAttachment[]>();
  const warningsByRef = new Map<string, QboAiWarning[]>();
  for (const entityResult of attachmentResult.byEntity) {
    const key = ctx.entityKey(
      entityResult.entityRef.entityType,
      entityResult.entityRef.entityId,
    );
    attachmentsByRef.set(key, entityResult.attachments);
    warningsByRef.set(key, entityResult.warnings);
  }

  const byDescriptor = new Map<string, QboNormalizedAttachment[]>();
  const warningsByDescriptor = new Map<string, QboAiWarning[]>();
  for (const [descriptorKey, refKeys] of descriptorRefs.entries()) {
    const byAttachmentId = new Map<string, QboNormalizedAttachment>();
    const descriptorWarnings: QboAiWarning[] = [];
    for (const refKey of refKeys) {
      for (const attachment of attachmentsByRef.get(refKey) ?? []) {
        const id = attachment.attachmentId
          ? `${attachment.attachmentId}:${attachment.linkedEntityType}:${attachment.linkedEntityId}`
          : `${refKey}:${byAttachmentId.size}`;
        byAttachmentId.set(id, attachment);
      }
      descriptorWarnings.push(...(warningsByRef.get(refKey) ?? []));
    }
    byDescriptor.set(descriptorKey, [...byAttachmentId.values()]);
    warningsByDescriptor.set(
      descriptorKey,
      ctx.normalizer.dedupeWarnings(descriptorWarnings),
    );
  }

  return {
    byDescriptor,
    warningsByDescriptor,
    warnings: attachmentResult.warnings,
    entitiesChecked: attachmentResult.coverage.entitiesChecked,
    attachmentsFound: attachmentResult.coverage.attachmentsFound,
    fallbackUsed: attachmentResult.coverage.fallbackUsed,
  };
}

export function toJobCostTransactionEngine(
  ctx: EnrichmentContext,
  descriptor: TransactionDescriptor,
  attachments: QboNormalizedAttachment[],
  attachmentWarnings: QboAiWarning[],
  includeRaw: boolean,
  attachmentsRequested: boolean,
): QboJobCostTransaction {
  const normalized = ctx.normalizeWithAttachments(descriptor.entityType, descriptor.raw, []);
  const warnings = [...normalized.warnings, ...attachmentWarnings];
  if (attachmentsRequested && attachments.length === 0) {
    warnings.push(
      ctx.normalizer.warning(
        'transaction_without_attachment',
        `${normalized.entityType} ${normalized.entityId} has no QuickBooks attachment metadata.`,
      ),
    );
  }
  const transaction: QboJobCostTransaction = {
    source: 'quickbooks',
    classification: descriptor.classification,
    direction: normalized.direction,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    docNumber: normalized.docNumber,
    txnDate: normalized.txnDate,
    totalAmount: normalized.totalAmount,
    allocatedAmount: descriptor.allocatedAmount,
    allocationRatio: descriptor.allocationRatio,
    allocationMethod: descriptor.allocationMethod,
    allocationDetails: descriptor.allocationDetails,
    projectRefs: normalized.projectRefs,
    lineItems: normalized.lineItems,
    linkedTxn: normalized.linkedTxn,
    memo: normalized.memo,
    description: normalized.description,
    attachments,
    warnings: ctx.normalizer.dedupeWarnings(warnings),
  };

  if (normalized.dueDate) transaction.dueDate = normalized.dueDate;
  if (normalized.vendor) transaction.vendor = normalized.vendor;
  if (normalized.customer) transaction.customer = normalized.customer;
  if (normalized.account) transaction.account = normalized.account;
  if (normalized.category) transaction.category = normalized.category;
  if (normalized.billableStatus) transaction.billableStatus = normalized.billableStatus;
  if (normalized.status) transaction.status = normalized.status;
  if (normalized.openBalance !== undefined) transaction.openBalance = normalized.openBalance;
  if (normalized.rawRef) transaction.rawRef = normalized.rawRef;
  if (includeRaw) transaction.raw = descriptor.raw;

  return transaction;
}

