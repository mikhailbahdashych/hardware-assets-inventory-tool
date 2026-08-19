import { createHmac } from 'node:crypto';

/**
 * The six digits an authenticator app would show for a secret, right now.
 *
 * Deliberately a **second** implementation rather than an import of the API's
 * `lib/totp.ts`: from here the server is a black box, and a code this file
 * computes from RFC 6238 is the same kind of evidence a real phone would
 * provide — interoperability, not agreement with itself. It is twenty lines
 * because that is all TOTP is; the server's copy is the one pinned to the
 * RFC's published test vectors.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;

export function totpCode(secret: string, now: Date = new Date()): string {
  const key = base32Decode(secret);
  const step = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);

  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.4: the low nibble of the last byte says
  // where to read four bytes, and the mask drops the sign bit.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** 6).padStart(6, '0');
}

function base32Decode(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of encoded.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`"${character}" is not base32, so this is not a secret.`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
