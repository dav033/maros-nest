import { randomBytes, createHash, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

/** 32 bytes = 256 bits. Guessing one is not a threat model; leaking one is. */
const TOKEN_BYTES = 32;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export interface GeneratedToken {
  /** Returned to the creator exactly once, then never recoverable. */
  token: string;
  hash: string;
  /** First characters, so the UI can tell two links apart without holding either. */
  hint: string;
}

export function generateShareToken(): GeneratedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashShareToken(token), hint: token.slice(0, 8) };
}

/**
 * Plain SHA-256, not bcrypt or scrypt, and that is deliberate: the token carries 256
 * bits of entropy, so there is nothing for key stretching to protect against, and the
 * lookup has to hit a unique index on every public read.
 */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Passwords are the opposite case — people pick short ones, so this is scrypt with a
 * per-password salt. Format is `scrypt$<salt-hex>$<key-hex>`, self-describing so a
 * future parameter change can be told apart from the current one.
 */
export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifySharePassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const derived = (await scryptAsync(
    password,
    Buffer.from(saltHex, 'hex'),
    expected.length,
  )) as Buffer;

  return timingSafeEqual(derived, expected);
}

/**
 * Hashes a visitor's IP with a server-side salt. Enough to count unique readers, never
 * enough to recover an address — a view log is useful, a list of client IPs is a
 * liability. Without the salt configured this returns null and the column stays empty
 * rather than storing something reversible.
 */
export function hashVisitorIp(ip: string | undefined, salt: string | undefined): string | null {
  if (!ip || !salt) return null;
  return createHash('sha256').update(`${ip}${salt}`).digest('hex');
}
