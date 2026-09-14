import { isLocalDevAuthBypassEnabled } from './dev-auth';

describe('isLocalDevAuthBypassEnabled', () => {
  const localConfig = {
    nodeEnv: 'development',
    enabled: 'true',
    devSecret: 'local-only-secret',
    authSecret: 'session-secret',
  };

  it('enables only with an explicit development flag and a separate secret', () => {
    expect(isLocalDevAuthBypassEnabled(localConfig)).toBe(true);
  });

  it('rejects the bypass outside development', () => {
    expect(
      isLocalDevAuthBypassEnabled({ ...localConfig, nodeEnv: 'production' }),
    ).toBe(false);
  });

  it('rejects the bypass when the flag is off or the secrets match', () => {
    expect(
      isLocalDevAuthBypassEnabled({ ...localConfig, enabled: 'false' }),
    ).toBe(false);
    expect(
      isLocalDevAuthBypassEnabled({
        ...localConfig,
        authSecret: localConfig.devSecret,
      }),
    ).toBe(false);
  });
});
