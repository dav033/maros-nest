import { trim } from './qbo-value.utils';

export async function resolveRealmIdOrDefault(
  realmId: unknown,
  getDefaultRealmId: () => Promise<string>,
): Promise<string> {
  return trim(realmId) || getDefaultRealmId();
}
