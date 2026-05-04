import { z } from 'zod';
import { McpToolDeps } from './shared';

export const realmIdParam = z
  .string()
  .optional()
  .describe(
    'QuickBooks company realm ID. Omit to use the default connected company.',
  );

export async function resolveRealmId(
  deps: McpToolDeps,
  realmId?: string,
): Promise<string> {
  return realmId ?? (await deps.qboFinancials.getDefaultRealmId());
}
