import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_PREFIX } from '../src/services/storage.js';

/**
 * The instance role in infrastructure/ may touch only one prefix of the
 * attachments bucket — and that prefix has to be the one the app writes under.
 * Nothing at runtime checks this: a drift shows up as AccessDenied on the first
 * upload of a full-scale deployment, which no unit test and no CI job runs. So
 * the two sources are read here and compared, the same way the twin schemas are.
 */
describe('the attachments prefix', () => {
  it('is the same string in storage.ts and in infrastructure/variables.tf', () => {
    const variables = readFileSync(
      join(import.meta.dirname, '../../../infrastructure/variables.tf'),
      'utf8',
    );
    const match = /attachments_prefix\s*=\s*"([^"]*)"/.exec(variables);
    // A missing local is a drift too — the grant would silently widen to `*`.
    expect(match, 'local.attachments_prefix is declared in variables.tf').not.toBeNull();
    expect(match![1]).toBe(KEY_PREFIX);
  });
});
