export function isLocalDevAuthBypassEnabled({
  nodeEnv,
  enabled,
  devSecret,
  authSecret,
}: {
  nodeEnv?: string;
  enabled?: string;
  devSecret?: string;
  authSecret?: string;
}): boolean {
  return (
    nodeEnv === 'development' &&
    enabled === 'true' &&
    Boolean(devSecret) &&
    devSecret !== authSecret
  );
}
