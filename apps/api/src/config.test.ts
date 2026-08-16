import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('provides zero-config defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dataDir).toBe('./data');
    expect(config.appUrl).toBe('http://localhost:3000');
    expect(config.cookieSecure).toBe(false);
  });

  it('derives a secure cookie from an https APP_URL', () => {
    expect(loadConfig({ APP_URL: 'https://inventory.acme.io' }).cookieSecure).toBe(true);
  });

  it('lets COOKIE_SECURE override the derivation', () => {
    expect(
      loadConfig({ APP_URL: 'https://inventory.acme.io', COOKIE_SECURE: 'false' }).cookieSecure,
    ).toBe(false);
    expect(loadConfig({ COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
  });

  it('rejects a malformed APP_URL or PORT', () => {
    expect(() => loadConfig({ APP_URL: 'not a url' })).toThrow();
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});
