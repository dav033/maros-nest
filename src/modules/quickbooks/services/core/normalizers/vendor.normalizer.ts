import { QboVendorSummary } from '../quickbooks-normalizer.types';
import { n, o, s } from '../quickbooks-normalizer.utils';

export function normalizeVendor(raw: Record<string, unknown>): QboVendorSummary {
  const emailObj = o(raw['PrimaryEmailAddr']);
  const phoneObj = o(raw['PrimaryPhone']);
  const currencyObj = o(raw['CurrencyRef']);
  const result: QboVendorSummary = {
    vendorId: s(raw['Id']),
    displayName: s(raw['DisplayName']),
    active: raw['Active'] !== false,
  };
  if (emailObj['Address']) result.email = s(emailObj['Address']);
  if (phoneObj['FreeFormNumber']) result.phone = s(phoneObj['FreeFormNumber']);
  if (raw['Balance'] !== undefined) result.balance = n(raw['Balance']);
  if (currencyObj['value']) result.currency = s(currencyObj['value']);
  return result;
}
