import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HMAC-SHA1, which is what every authenticator app
 * implements and what `otpauth://` URIs default to.
 *
 * Hand-written rather than pulled from a package because it is thirty lines of
 * standard primitives — an HMAC over a counter — and because the RFC publishes
 * test vectors, so it is verifiable rather than trusted. `totp.test.ts` runs
 * all six of them.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** One step either side: phone clocks drift, and a code typed at :29 arrives at :31. */
const WINDOW_STEPS = 1;

// RFC 4648 base32. No 0, 1 or 8 — they are the characters people confuse with
// O, I and B when reading a secret off a screen.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      // Safe: `bits - 5` is in [0, 7] and the mask keeps the index under 32.
      output += ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]!;
  return output;
}

/**
 * Tolerant of how a secret reaches us — apps display them in spaced groups,
 * people paste them lowercase, encoders add `=` padding — and strict about
 * anything that is not base32 at all, which is a corrupt secret, not a typo.
 */
export function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const character of cleaned) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(`"${character}" is not a base32 character.`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

/** 160 bits, the length RFC 4226 recommends for the shared secret. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 6-digit code for a moment, per RFC 6238's HOTP-over-time construction. */
export function totpCode(secret: string, now: Date): string {
  return codeForStep(base32Decode(secret), Math.floor(now.getTime() / 1000 / PERIOD_SECONDS));
}

function codeForStep(key: Uint8Array, step: number): string {
  // The counter is eight bytes, big-endian. A step fits in 53 bits for the next
  // several million years, so a BigInt buys nothing here.
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.4. The low nibble of the last byte picks
  // where to read, and the mask drops the sign bit.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Whether a code is live for this secret, within one step either side.
 *
 * Fails closed on anything malformed — a corrupt secret column must not turn
 * the login route into a 500, and a five-character code is a wrong code, not
 * an error. The comparison is constant-time so a code cannot be guessed a
 * digit at a time.
 */
export function verifyTotp(secret: string, code: string, now: Date): boolean {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;

  let key: Uint8Array;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const current = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    if (equalsConstantTime(codeForStep(key, current + offset), candidate)) return true;
  }
  return false;
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself public here:
  // both sides are always six digits by the time we get this far.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The `otpauth://` URI an authenticator app scans. The label is
 * `issuer:account`, and both halves are percent-encoded — a workspace called
 * "Acme: the sequel" would otherwise split the label and name a wrong issuer.
 */
export function otpauthUri(secret: string, email: string, orgName: string): string {
  const label = `${encodeURIComponent(orgName)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret,
    issuer: orgName,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
