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

  describe('SMTP', () => {
    it('is absent by default — an instance without email still runs', () => {
      expect(loadConfig({}).smtp).toBeNull();
    });

    it('needs a host to exist at all; everything else has a default', () => {
      expect(loadConfig({ SMTP_PORT: '465' }).smtp).toBeNull();
      expect(loadConfig({ SMTP_HOST: 'smtp.acme.io' }).smtp).toEqual({
        host: 'smtp.acme.io',
        port: 587,
        secure: false,
        auth: null,
        from: 'Inventory <inventory@localhost>',
      });
    });

    it('takes credentials only when both halves are there', () => {
      expect(loadConfig({ SMTP_HOST: 'smtp.acme.io', SMTP_USER: 'bot' }).smtp?.auth).toBeNull();
      expect(
        loadConfig({ SMTP_HOST: 'smtp.acme.io', SMTP_USER: 'bot', SMTP_PASS: 'hunter2' }).smtp
          ?.auth,
      ).toEqual({ user: 'bot', pass: 'hunter2' });
    });

    it('derives implicit TLS from the port, and lets SMTP_SECURE say otherwise', () => {
      expect(loadConfig({ SMTP_HOST: 'x', SMTP_PORT: '465' }).smtp?.secure).toBe(true);
      expect(loadConfig({ SMTP_HOST: 'x', SMTP_PORT: '587' }).smtp?.secure).toBe(false);
      expect(
        loadConfig({ SMTP_HOST: 'x', SMTP_PORT: '465', SMTP_SECURE: 'false' }).smtp?.secure,
      ).toBe(false);
    });

    it('takes the From address as written', () => {
      expect(loadConfig({ SMTP_HOST: 'x', SMTP_FROM: 'IT <it@acme.io>' }).smtp?.from).toBe(
        'IT <it@acme.io>',
      );
    });
  });
});
