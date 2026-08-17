import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

function mockFetch(status: number, body?: unknown, contentType = 'application/json') {
  const response = new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': contentType },
  });
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns the parsed body of a successful request', async () => {
    mockFetch(200, { member: { id: 'm1' } });
    await expect(apiFetch('/auth/me')).resolves.toEqual({ member: { id: 'm1' } });
  });

  it('prefixes the versioned API base and sends same-origin credentials', async () => {
    const spy = mockFetch(200, {});
    await apiFetch('/meta');
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/v1/meta');
    expect(init.credentials).toBe('same-origin');
  });

  it('sends JSON bodies with a content type', async () => {
    const spy = mockFetch(200, {});
    await apiFetch('/auth/login', { method: 'POST', body: { email: 'a@b.co', password: 'x' } });
    const [, init] = spy.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('resolves to undefined for 204 responses', async () => {
    mockFetch(204);
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws ApiError carrying the server error envelope', async () => {
    mockFetch(401, {
      error: { code: 'invalid_credentials', message: 'Incorrect email or password.' },
    });
    const error = (await apiFetch('/auth/login', { method: 'POST' }).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('invalid_credentials');
    expect(error.message).toBe('Incorrect email or password.');
  });

  it('exposes field errors from validation failures', async () => {
    mockFetch(422, {
      error: {
        code: 'validation',
        message: 'Request validation failed.',
        fields: { email: 'Invalid email' },
      },
    });
    const error = (await apiFetch('/setup', { method: 'POST' }).catch((e) => e)) as ApiError;
    expect(error.fields).toEqual({ email: 'Invalid email' });
  });

  it('falls back to a readable message when the response is not JSON', async () => {
    mockFetch(502, undefined);
    const error = (await apiFetch('/meta').catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).toBeTruthy();
  });
});
