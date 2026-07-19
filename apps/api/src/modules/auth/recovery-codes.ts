import { createHash, randomInt } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;

/** Crockford-ish base32 (lowercase, no i/l/o/u) — unambiguous to read aloud. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const GROUP = 5;

function randomGroup(): string {
  let out = '';
  for (let i = 0; i < GROUP; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** 10 single-use codes, format xxxxx-xxxxx (50 bits of entropy each). */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(`${randomGroup()}-${randomGroup()}`);
  return [...codes];
}

/** sha256 of the normalized code — high-entropy input, no salt needed. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}
