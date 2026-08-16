import { createHash, randomBytes } from 'node:crypto';

// Session and invite/reset tokens: the browser holds the raw token, the
// database stores only its sha256 — a DB leak never leaks usable tokens,
// and no signing secret is needed anywhere (keeps the container zero-config).

export function createRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
