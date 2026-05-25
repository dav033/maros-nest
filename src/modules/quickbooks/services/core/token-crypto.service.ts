import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM encryption for QBO tokens at rest.
 * Ciphertext format: {iv_hex}:{authTag_hex}:{encrypted_hex}
 * Key source: QB_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * If the key is not configured, tokens are stored/read as plaintext (passthrough).
 */
@Injectable()
export class TokenCryptoService implements OnModuleInit {
  private key?: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const hexKey = this.configService.get<string>('QB_ENCRYPTION_KEY');
    if (!hexKey) return;
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error(
        `QB_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${hexKey.length}.`,
      );
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag(); // 16 bytes

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    if (!this.key) return ciphertext;
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      // Stored as plaintext (key was added later) — return as-is.
      return ciphertext;
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }
}
