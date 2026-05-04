import { QboAiWarning, QboRef } from '../core/quickbooks-normalizer.service';

export interface QboAttachmentEntityRef {
  entityType: string;
  entityId: string;
  name?: string;
}

export interface QboAttachmentOptions {
  includeTempDownloadUrl?: boolean;
}

export interface QboProjectAttachmentsParams extends QboAttachmentOptions {
  realmId?: string;
  projectNumber?: string;
  qboCustomerId?: string;
  startDate?: string;
  endDate?: string;
}

export interface QboNormalizedAttachment {
  attachmentId: string;
  fileName: string;
  contentType: string;
  size: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  linkedEntityType: string;
  linkedEntityId: string;
  includeOnSend: boolean;
  hasDownloadUrl: boolean;
  downloadUrlExpires: string | null;
  downloadUrlFetchedAt?: string;
  tempDownloadUrl?: string;
}

export interface QboAttachmentDownloadUrl {
  attachmentId: string;
  tempDownloadUrl: string;
  downloadUrlFetchedAt: string;
  downloadUrlExpires: string | null;
  warnings: QboAiWarning[];
}

export interface QboAttachmentEntityResult {
  entityRef: QboAttachmentEntityRef;
  attachments: QboNormalizedAttachment[];
  warnings: QboAiWarning[];
  fallbackUsed: boolean;
}

export type QboAttachmentLookupResult = QboAttachmentEntityResult;

export interface QboAttachmentsForEntitiesResult {
  attachments: QboNormalizedAttachment[];
  byEntity: QboAttachmentEntityResult[];
  warnings: QboAiWarning[];
  coverage: {
    entitiesChecked: number;
    attachmentsFound: number;
    fallbackUsed: boolean;
  };
}

export interface QboProjectAttachmentRef {
  found: boolean;
  projectNumber?: string;
  qboCustomerId?: string;
  displayName?: string;
  refs: QboRef[];
}

export interface QboProjectAttachmentsResult {
  project: QboProjectAttachmentRef;
  entityRefs: QboAttachmentEntityRef[];
  attachments: QboNormalizedAttachment[];
  byEntity: QboAttachmentEntityResult[];
  warnings: QboAiWarning[];
  coverage: {
    entitiesChecked: number;
    attachmentsFound: number;
    fallbackUsed: boolean;
  };
}

export type ProjectAttachmentEntity =
  | 'Customer'
  | 'Invoice'
  | 'Estimate'
  | 'Payment'
  | 'Purchase'
  | 'Bill'
  | 'BillPayment'
  | 'VendorCredit'
  | 'PurchaseOrder'
  | 'JournalEntry';

export interface QboCustomerRecord {
  Id?: unknown;
  DisplayName?: unknown;
  FullyQualifiedName?: unknown;
  [key: string]: unknown;
}
