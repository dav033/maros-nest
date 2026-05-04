import { QboAttachmentSummary } from '../quickbooks-normalizer.types';
import { normalizeAttachable as normalizeAttachableEntity } from '../quickbooks-normalizer.utils';

export function normalizeAttachable(raw: Record<string, unknown>): QboAttachmentSummary {
  return normalizeAttachableEntity(raw);
}
