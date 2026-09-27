// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

/**
 * Whether the dev server hands a path to the API, by Vite's own rule: a proxy
 * key matches as a prefix, or as a regular expression when it starts with `^`.
 */
function proxied(path: string): boolean {
  return Object.keys(config.server!.proxy!).some((key) =>
    key.startsWith('^') ? new RegExp(key).test(path) : path.startsWith(key),
  );
}

describe('the dev proxy', () => {
  it('sends the API’s namespace to the API — both surfaces', () => {
    expect(proxied('/api/v1/meta')).toBe(true);
    expect(proxied('/api/public/openapi.json')).toBe(true);
  });

  it('leaves the pages that merely begin with those letters to the app', () => {
    // A reload of either used to reach the API and come back as 404 JSON.
    for (const page of ['/api-tokens', '/api-docs']) {
      expect(proxied(page), page).toBe(false);
    }
  });
});
