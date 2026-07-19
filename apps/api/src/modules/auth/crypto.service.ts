import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Encrypts small secrets (MFA TOTP seeds) at rest with AES-256-GCM.
 * Stored format: base64(iv).base64(ciphertext).base64(authTag).
 * The key is APP_ENCRYPTION_KEY (validated 64-hex = 32 bytes at boot).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('encryptionKey'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${ciphertext.toString('base64')}.${tag.toString('base64')}`;
  }

  /** Throws on tampered/foreign/malformed input — callers treat that as data corruption. */
  decrypt(blob: string): string {
    const [iv, ciphertext, tag] = blob.split('.').map((part) => Buffer.from(part, 'base64'));
    if (!iv?.length || !ciphertext?.length || tag?.length !== 16) {
      // Full-length GCM tag only — Node otherwise accepts truncated tags.
      throw new Error('malformed encrypted blob');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
