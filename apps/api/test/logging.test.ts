import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { redactSensitiveUrl } from '@/lib/logging.js';
import { buildTestApp, inject, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Collects every log line the app writes, so a test can read them back. */
function captureLog(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, stream };
}

/**
 * The database stores only `sha256(raw)` of every invite and reset token, so a
 * raw one exists in exactly two places: the response that created it, and the
 * link an admin pastes to somebody. The request log must not become a third.
 */
describe('redactSensitiveUrl', () => {
  it('keeps the raw invite token out of the line the URL is logged on', () => {
    expect(redactSensitiveUrl('/api/v1/auth/invite/9f8e7d6c5b4a39281706')).toBe(
      '/api/v1/auth/invite/[redacted]',
    );
  });

  it('redacts a token passed as a query parameter, whatever else is there', () => {
    expect(redactSensitiveUrl('/api/v1/anything?token=9f8e7d6c&type=auth')).toBe(
      '/api/v1/anything?token=[redacted]&type=auth',
    );
    expect(redactSensitiveUrl('/x?type=auth&token=abc')).toBe('/x?type=auth&token=[redacted]');
  });

  it('leaves everything else exactly as it was, so the log stays useful', () => {
    for (const url of [
      '/api/v1/assets',
      '/api/v1/assets?status=in_repair&q=macbook',
      '/api/v1/audit?type=assets&limit=200&offset=0',
      '/api/v1/assets/1abbf12d-ef18-4ce8-bf54-324c1a356dc0',
      '/api/v1/import/template?kind=assets',
      '/',
    ]) {
      expect(redactSensitiveUrl(url), url).toBe(url);
    }
  });

  it('does not mistake a path that merely mentions invite for a token', () => {
    // The list of pending invitations is not a secret; its URL carries none.
    expect(redactSensitiveUrl('/api/v1/members/invites')).toBe('/api/v1/members/invites');
    expect(redactSensitiveUrl('/api/v1/members/abc-123/resend-invite')).toBe(
      '/api/v1/members/abc-123/resend-invite',
    );
  });

  it('is actually wired in — a real request logs no raw token', async () => {
    const { lines, stream } = captureLog();
    ctx = await buildTestApp({ LOG_LEVEL: 'info' }, undefined, stream);

    const raw = 'SUPERSECRETRAWTOKEN123';
    await inject(ctx.app, { method: 'GET', url: `/api/v1/auth/invite/${raw}` });

    const written = lines.join('');
    expect(written).not.toContain(raw);
    // …and the line is still there, still useful.
    expect(written).toContain('/api/v1/auth/invite/[redacted]');
  });

  it('does not put the session cookie in the log either', async () => {
    const { lines, stream } = captureLog();
    ctx = await buildTestApp({ LOG_LEVEL: 'info' }, undefined, stream);

    await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/meta',
      cookie: 'inv_session=a-session-token-nobody-should-read',
    });

    expect(lines.join('')).not.toContain('a-session-token-nobody-should-read');
  });

  it('survives the shapes a hostile or broken client can send', () => {
    expect(redactSensitiveUrl('/api/v1/auth/invite/')).toBe('/api/v1/auth/invite/');
    expect(redactSensitiveUrl('/api/v1/auth/invite')).toBe('/api/v1/auth/invite');
    expect(redactSensitiveUrl('')).toBe('');
    // A token that itself looks like a path stays fully covered.
    expect(redactSensitiveUrl('/api/v1/auth/invite/a/b/c')).toBe('/api/v1/auth/invite/[redacted]');
  });
});
