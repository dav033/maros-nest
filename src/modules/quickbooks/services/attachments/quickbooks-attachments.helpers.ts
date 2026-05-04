import { QboRef } from '../core/quickbooks-normalizer.service';
import {
  asRecord,
  asRecordArray,
  normalizeName,
  numberValue,
  stringValue,
  trim,
} from '../core/qbo-value.utils';
import {
  QboAttachmentEntityRef,
  QboProjectAttachmentRef,
} from './quickbooks-attachments.types';

export class QuickbooksAttachmentsHelpers {
  asRecord(value: unknown): Record<string, unknown> {
    return asRecord(value);
  }

  asArray(value: unknown): Record<string, unknown>[] {
    return asRecordArray(value);
  }

  stringValue(value: unknown): string {
    return stringValue(value);
  }

  numberValue(value: unknown): number {
    return numberValue(value);
  }

  trim(value: unknown): string {
    return trim(value);
  }

  normalizeName(value: unknown): string {
    return normalizeName(value);
  }

  nameMatchesProject(value: string, project: string): boolean {
    if (!value || !project) return false;
    if (value === project) return true;
    if (value.startsWith(`${project},`)) return true;
    const parts = value
      .split(/[:,]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.includes(project);
  }

  hasProjectIdentity(project: QboProjectAttachmentRef): boolean {
    return project.refs.some((ref) => ref.value || ref.name);
  }

  projectRefMatches(ref: QboRef, project: QboProjectAttachmentRef): boolean {
    const projectIds = new Set(
      project.refs.map((projectRef) => projectRef.value).filter(Boolean),
    );
    if (ref.value && projectIds.has(ref.value)) return true;

    const refName = this.normalizeName(ref.name);
    if (!refName) return false;

    const projectNames = [
      project.projectNumber,
      project.displayName,
      ...project.refs.map((projectRef) => projectRef.name),
    ]
      .map((value) => this.normalizeName(value))
      .filter(Boolean);

    return projectNames.some((candidate) =>
      this.nameMatchesProject(refName, candidate),
    );
  }

  extractAttachableRefs(raw: Record<string, unknown>): QboAttachmentEntityRef[] {
    return this.asArray(raw['AttachableRef'])
      .map((ref) => {
        const entityRef = this.asRecord(ref['EntityRef']);
        const entityType = this.stringValue(entityRef['type']);
        const entityId = this.stringValue(entityRef['value']);
        if (!entityType || !entityId) return null;
        const name = this.stringValue(entityRef['name']);
        const result: QboAttachmentEntityRef = {
          entityType,
          entityId,
        };
        if (name) result.name = name;
        return result;
      })
      .filter((ref): ref is QboAttachmentEntityRef => ref !== null);
  }

  attachmentLinksToEntity(
    attachment: Record<string, unknown>,
    entityRef: QboAttachmentEntityRef,
  ): boolean {
    return this.extractAttachableRefs(attachment).some(
      (ref) =>
        ref.entityType === entityRef.entityType &&
        ref.entityId === entityRef.entityId,
    );
  }

  includeOnSend(
    raw: Record<string, unknown>,
    entityRef: QboAttachmentEntityRef,
  ): boolean {
    const attachableRef = this.asArray(raw['AttachableRef']).find((ref) => {
      const qboEntityRef = this.asRecord(ref['EntityRef']);
      return (
        this.stringValue(qboEntityRef['type']) === entityRef.entityType &&
        this.stringValue(qboEntityRef['value']) === entityRef.entityId
      );
    });
    return attachableRef ? Boolean(attachableRef['IncludeOnSend']) : false;
  }

  uniqueEntityRefs(entityRefs: QboAttachmentEntityRef[]): QboAttachmentEntityRef[] {
    const refs = new Map<string, QboAttachmentEntityRef>();
    for (const ref of entityRefs) {
      if (!ref.entityType || !ref.entityId) continue;
      refs.set(`${ref.entityType}:${ref.entityId}`, ref);
    }
    return [...refs.values()];
  }
}
