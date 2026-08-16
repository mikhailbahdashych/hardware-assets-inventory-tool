import { describe, expect, it } from 'vitest';
import { createRawToken, hashToken } from './tokens.js';

describe('tokens', () => {
  it('creates url-safe random tokens of 32 bytes', () => {
    const token = createRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createRawToken()).not.toBe(token);
  });

  it('hashes deterministically to sha256 hex', () => {
    const raw = 'fixed-token-value';
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken('other')).not.toBe(hashToken(raw));
  });
});
