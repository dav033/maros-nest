import type {
  QboVendorMatchCandidate,
  QboVendorMatchStatus,
} from './quickbooks-vendor-matching.service';

const COMPANY_SUFFIXES = new Set([
  'co',
  'company',
  'corp',
  'corporation',
  'inc',
  'incorporated',
  'limited',
  'llc',
  'llp',
  'lp',
  'ltd',
  'pc',
  'plc',
  'pllc',
]);

export function normalizeCompanyName(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !COMPANY_SUFFIXES.has(token))
    .join(' ')
    .trim();
}

export function normalizeEmail(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function normalizePhone(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export function phoneMatches(companyPhone: string, vendorPhone: string): boolean {
  return (
    companyPhone === vendorPhone ||
    companyPhone.endsWith(vendorPhone) ||
    vendorPhone.endsWith(companyPhone)
  );
}

export function compareCandidates(
  a: QboVendorMatchCandidate,
  b: QboVendorMatchCandidate,
): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.vendorName.localeCompare(b.vendorName);
}

export function statusRank(status: QboVendorMatchStatus): number {
  switch (status) {
    case 'confirmed':
      return 5;
    case 'suggested':
      return 4;
    case 'low_confidence':
      return 3;
    case 'manual_match_protected':
      return 2;
    case 'unmatched':
      return 1;
  }
}

export function nameSimilarity(a: string, b: string): number {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  const substringScore = shorter.length >= 6 && longer.includes(shorter) ? 0.86 : 0;
  return Math.max(substringScore, tokenDiceSimilarity(a, b), levenshteinSimilarity(a, b));
}

function tokenDiceSimilarity(a: string, b: string): number {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token));
  return (2 * intersection.length) / (aTokens.size + bTokens.size);
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  const distance = previous[b.length];
  return 1 - distance / Math.max(a.length, b.length);
}
