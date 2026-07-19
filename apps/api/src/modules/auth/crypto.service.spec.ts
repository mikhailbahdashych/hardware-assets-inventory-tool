import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const KEY = 'a'.repeat(64); // 32 bytes hex

function service(key = KEY): CryptoService {
  const config = {
    getOrThrow: (k: string) => {
      if (k !== 'encryptionKey') throw new Error(`unexpected key ${k}`);
      return key;
    },
  } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService (AES-256-GCM)', () => {
  it('round-trips plaintext', () => {
    const s = service();
    const encrypted = s.encrypt('JBSWY3DPEHPK3PXP');
    expect(s.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a fresh IV every time (same plaintext, different ciphertext)', () => {
    const s = service();
    expect(s.encrypt('same')).not.toBe(s.encrypt('same'));
  });

  it('stores as three base64 segments (iv.ciphertext.tag)', () => {
    const parts = service().encrypt('x').split('.');
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('rejects tampered ciphertext', () => {
    const s = service();
    const encrypted = s.encrypt('sensitive');
    const [iv, ct, tag] = encrypted.split('.');
    const tamperedCt = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => s.decrypt(`${iv}.${tamperedCt}.${tag}`)).toThrow();
  });

  it('rejects ciphertext encrypted under a different key', () => {
    const encrypted = service('b'.repeat(64)).encrypt('secret');
    expect(() => service().decrypt(encrypted)).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => service().decrypt('not-a-valid-blob')).toThrow();
  });
});
