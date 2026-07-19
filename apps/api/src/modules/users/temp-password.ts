import { randomInt } from 'node:crypto';

/** Same unambiguous alphabet as recovery codes (no i/l/o/u). */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 16;

/** One-time temp password an admin hands to a new/reset user (~80 bits). */
export function generateTempPassword(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
