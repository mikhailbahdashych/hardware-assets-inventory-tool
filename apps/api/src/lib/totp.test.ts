import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp.js';

/**
 * RFC 6238's own test vectors, on the shared secret the RFC uses
 * ("12345678901234567890" as ASCII). They are published as 8-digit codes; this
 * app shows 6, which is the last six digits of the same number.
 *
 * These are what make a hand-written TOTP trustworthy rather than hopeful — if
 * any of it is wrong, one of these fails.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

const RFC_VECTORS: [seconds: number, eightDigits: string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const value of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '12345678901234567890']) {
      const bytes = Buffer.from(value, 'ascii');
      expect(Buffer.from(base32Decode(base32Encode(bytes))).equals(bytes), value).toBe(true);
    }
  });

  it('produces the encoding the RFC and every authenticator app expect', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('reads a secret back however a person typed it', () => {
    const canonical = base32Decode('GEZDGNBVGY3TQOJQ');
    // Authenticator apps show secrets in spaced groups, and people paste them
    // lowercase or with the padding an encoder added.
    expect(Buffer.from(base32Decode('gezdgnbvgy3tqojq')).equals(Buffer.from(canonical))).toBe(true);
    expect(Buffer.from(base32Decode('GEZD GNBV GY3T QOJQ')).equals(Buffer.from(canonical))).toBe(
      true,
    );
    expect(Buffer.from(base32Decode('GEZDGNBVGY3TQOJQ====')).equals(Buffer.from(canonical))).toBe(
      true,
    );
  });

  it('refuses characters that are not in the alphabet', () => {
    expect(() => base32Decode('GEZD!NBV')).toThrow(/base32/i);
    // 0, 1 and 8 are excluded from RFC 4648 base32 precisely to avoid O/I/B.
    expect(() => base32Decode('GEZD0NBV')).toThrow(/base32/i);
  });
});

describe('totpCode', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at t=%i', (seconds, eightDigits) => {
    expect(totpCode(RFC_SECRET, new Date(seconds * 1000))).toBe(eightDigits.slice(-6));
  });

  it('changes every 30 seconds and not within one', () => {
    const at = (s: number) => totpCode(RFC_SECRET, new Date(s * 1000));
    expect(at(30)).toBe(at(59));
    expect(at(30)).not.toBe(at(60));
  });
});

describe('verifyTotp', () => {
  const now = new Date(1111111109 * 1000);

  it('accepts the code for this moment', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
  });

  it('accepts one step either side, because clocks drift', () => {
    const previous = totpCode(RFC_SECRET, new Date(now.getTime() - 30_000));
    const next = totpCode(RFC_SECRET, new Date(now.getTime() + 30_000));
    expect(verifyTotp(RFC_SECRET, previous, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, next, now)).toBe(true);
  });

  it('refuses two steps away, so the window stays a window', () => {
    const stale = totpCode(RFC_SECRET, new Date(now.getTime() - 90_000));
    expect(verifyTotp(RFC_SECRET, stale, now)).toBe(false);
  });

  it('refuses anything that is not a live code', () => {
    for (const bad of ['', '000000', 'abcdef', '12345', '1234567', '  ']) {
      expect(verifyTotp(RFC_SECRET, bad, now), bad).toBe(false);
    }
  });

  it('reads a code the way a person types it, spaces and all', () => {
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, ` ${code.slice(0, 3)} ${code.slice(3)} `, now)).toBe(true);
  });

  it('says no rather than throwing when the stored secret is unusable', () => {
    // A corrupt column must fail closed, not 500 the login route.
    expect(verifyTotp('not-base32!', '123456', now)).toBe(false);
    expect(verifyTotp('', '123456', now)).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('is 160 bits, the length the RFC recommends, and decodes', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('is different every time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe('otpauthUri', () => {
  it('is the URI an authenticator app expects to scan', () => {
    const uri = new URL(otpauthUri('GEZDGNBVGY3TQOJQ', 'ada@acme.io', 'Acme Corp'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Acme Corp:ada@acme.io');
    expect(uri.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQ');
    expect(uri.searchParams.get('issuer')).toBe('Acme Corp');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });

  it('escapes a workspace name with a colon in it', () => {
    // A raw colon would split the label and name the wrong issuer.
    const uri = otpauthUri('GEZDGNBVGY3TQOJQ', 'ada@acme.io', 'Acme: the sequel');
    expect(uri).not.toMatch(/totp\/Acme: the sequel/);
    expect(decodeURIComponent(new URL(uri).pathname)).toBe('/Acme: the sequel:ada@acme.io');
  });
});
