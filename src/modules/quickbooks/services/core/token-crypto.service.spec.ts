import { TokenCryptoService } from './token-crypto.service';

const QB_KEY = 'a'.repeat(64);
const GOOGLE_KEY = 'b'.repeat(64);

/** A ConfigService stand-in: this service only ever reads two keys from it. */
function service(config: { QB_ENCRYPTION_KEY?: string; GOOGLE_TOKEN_ENCRYPTION_KEY?: string } = {}) {
  const svc = new TokenCryptoService({
    get: (key: string) => config[key as keyof typeof config],
  } as never);
  svc.onModuleInit();
  return svc;
}

/**
 * This is what stands between a database backup and someone else's QuickBooks company
 * file. The tests pin the three properties that matter: a round trip returns exactly what
 * went in, tampering is detected rather than silently decrypted, and a missing key degrades
 * in the documented way instead of throwing somewhere unrelated.
 */
describe('TokenCryptoService', () => {
  describe('QuickBooks tokens', () => {
    it('returns the original token after a round trip', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });
      const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';

      expect(svc.decrypt(svc.encrypt(token))).toBe(token);
    });

    it('produces different ciphertext each time, so equal tokens are not recognisable', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });

      const first = svc.encrypt('same-token');
      const second = svc.encrypt('same-token');

      expect(first).not.toBe(second);
      expect(svc.decrypt(first)).toBe('same-token');
      expect(svc.decrypt(second)).toBe('same-token');
    });

    it('writes iv:authTag:ciphertext, with a 96-bit IV and a 128-bit tag', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });

      const [iv, authTag, encrypted] = svc.encrypt('token').split(':');

      expect(iv).toHaveLength(24); // 12 bytes
      expect(authTag).toHaveLength(32); // 16 bytes
      expect(encrypted.length).toBeGreaterThan(0);
    });

    /** GCM is authenticated: a backup someone edited must fail loudly, not decrypt to junk. */
    it('refuses to decrypt ciphertext that was altered', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });
      const [iv, authTag, encrypted] = svc.encrypt('token').split(':');
      const flipped = encrypted.startsWith('0')
        ? `1${encrypted.slice(1)}`
        : `0${encrypted.slice(1)}`;

      expect(() => svc.decrypt(`${iv}:${authTag}:${flipped}`)).toThrow();
    });

    it('refuses to decrypt when the auth tag was replaced', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });
      const [iv, , encrypted] = svc.encrypt('token').split(':');

      expect(() => svc.decrypt(`${iv}:${'0'.repeat(32)}:${encrypted}`)).toThrow();
    });

    it('cannot read a token encrypted under a different key', () => {
      const ciphertext = service({ QB_ENCRYPTION_KEY: QB_KEY }).encrypt('token');
      const other = service({ QB_ENCRYPTION_KEY: 'c'.repeat(64) });

      expect(() => other.decrypt(ciphertext)).toThrow();
    });

    it('round-trips unicode and an empty string without corrupting them', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });

      expect(svc.decrypt(svc.encrypt('refresh—ñ–✓'))).toBe('refresh—ñ–✓');
      expect(svc.decrypt(svc.encrypt(''))).toBe('');
    });
  });

  describe('without a key configured', () => {
    /**
     * Documented passthrough: the key was introduced after tokens were already stored, so
     * an unconfigured deployment keeps working on plaintext rather than failing to connect.
     */
    it('stores and reads tokens as plaintext', () => {
      const svc = service();

      expect(svc.encrypt('plain-token')).toBe('plain-token');
      expect(svc.decrypt('plain-token')).toBe('plain-token');
    });

    it('reads a plaintext token written before a key existed', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });

      expect(svc.decrypt('legacy-plaintext-token')).toBe('legacy-plaintext-token');
    });

    /**
     * The sharp edge of inferring "encrypted" from the colon count: a plaintext token that
     * happens to contain two colons is taken for ciphertext and fails to decrypt. No QBO
     * token looks like this today, which is why the heuristic holds — but it is a property
     * of the data, not of the code, so it is worth having written down.
     */
    it('mistakes a plaintext value with two colons for ciphertext', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });

      expect(() => svc.decrypt('not:really:encrypted')).toThrow();
    });
  });

  describe('key validation', () => {
    it.each([
      ['too short', 'abc'],
      ['63 hex chars', 'a'.repeat(63)],
      ['65 hex chars', 'a'.repeat(65)],
      ['right length, not hex', 'z'.repeat(64)],
    ])('rejects a QuickBooks key that is %s', (_label, key) => {
      expect(() => service({ QB_ENCRYPTION_KEY: key })).toThrow(/64 hex characters/);
    });

    it('rejects a malformed Google key too', () => {
      expect(() => service({ GOOGLE_TOKEN_ENCRYPTION_KEY: 'nope' })).toThrow(/64 hex characters/);
    });

    it('accepts upper-case hex', () => {
      expect(() => service({ QB_ENCRYPTION_KEY: 'A'.repeat(64) })).not.toThrow();
    });
  });

  describe('Google Calendar tokens', () => {
    it('round-trips under its own key', () => {
      const svc = service({ GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_KEY });

      expect(svc.decryptGoogle(svc.encryptGoogle('google-refresh'))).toBe('google-refresh');
    });

    /**
     * Unlike the QuickBooks pair, these refuse rather than fall back: Google tokens were
     * only ever written with a key configured, so plaintext here means something is wrong
     * and silently passing it through would hide it.
     */
    it('refuses to encrypt or decrypt when no Google key is configured', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY });

      expect(() => svc.encryptGoogle('x')).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
      expect(() => svc.decryptGoogle('a:b:c')).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
    });

    it('rejects a Google value that is not encrypted at all', () => {
      const svc = service({ GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_KEY });

      expect(() => svc.decryptGoogle('plaintext')).toThrow(/not encrypted or is malformed/);
    });

    it('keeps the two key spaces separate', () => {
      const svc = service({ QB_ENCRYPTION_KEY: QB_KEY, GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_KEY });

      // A QuickBooks ciphertext must not be readable as a Google one, or one leaked key
      // would open both.
      expect(() => svc.decryptGoogle(svc.encrypt('qb-token'))).toThrow();
    });
  });
});
