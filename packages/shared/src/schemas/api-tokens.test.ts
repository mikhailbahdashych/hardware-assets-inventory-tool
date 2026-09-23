import { describe, expect, it } from 'vitest';
import { apiTokenCreateSchema } from './api-tokens.js';

const valid = { name: 'Deploy bot', scopes: ['assets:read'], expiresInDays: 90 };

describe('apiTokenCreateSchema', () => {
  it('takes a name, at least one scope and one of the four windows', () => {
    expect(apiTokenCreateSchema.parse(valid)).toEqual(valid);
    expect(apiTokenCreateSchema.parse({ ...valid, expiresInDays: null }).expiresInDays).toBe(null);
    for (const days of [30, 90, 180]) {
      expect(apiTokenCreateSchema.safeParse({ ...valid, expiresInDays: days }).success).toBe(true);
    }
  });

  it('refuses a token nobody named, and one named at length', () => {
    expect(apiTokenCreateSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false);
    expect(apiTokenCreateSchema.safeParse({ ...valid, name: 'x'.repeat(101) }).success).toBe(false);
    expect(apiTokenCreateSchema.safeParse({ ...valid, name: 'x'.repeat(100) }).success).toBe(true);
  });

  /**
   * Every one of these reaches a person now: 422 field messages land under the
   * input that caused them, so a refusal has to be a sentence rather than
   * zod's own "Too big: expected string to have <=100 characters".
   */
  it('says what is wrong in words a person can act on', () => {
    const messages = (input: unknown): string[] => {
      const result = apiTokenCreateSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };

    expect(messages({ ...valid, name: '  ' })).toEqual(['Give the token a name.']);
    expect(messages({ ...valid, name: 'x'.repeat(101) })).toEqual([
      'Keep the name to 100 characters or fewer.',
    ]);
    expect(messages({ ...valid, scopes: [] })).toEqual([
      'Choose at least one scope — a token that may do nothing has no purpose.',
    ]);
    for (const message of [
      ...messages({ ...valid, name: '' }),
      ...messages({ ...valid, scopes: [] }),
    ]) {
      expect(message, message).not.toMatch(/expected|invalid_type|Too (big|small)/i);
    }
  });

  /** A token that may do nothing is a credential with no purpose. */
  it('refuses an empty scope list and a scope from no vocabulary of ours', () => {
    expect(apiTokenCreateSchema.safeParse({ ...valid, scopes: [] }).success).toBe(false);
    expect(apiTokenCreateSchema.safeParse({ ...valid, scopes: ['members:write'] }).success).toBe(
      false,
    );
    // The member action vocabulary is not this one, however close it looks.
    expect(apiTokenCreateSchema.safeParse({ ...valid, scopes: ['assets.create'] }).success).toBe(
      false,
    );
  });

  /** A checkbox grid cannot tick a box twice; a client that repeats one means it once. */
  it('dedupes repeated scopes rather than storing one twice', () => {
    expect(
      apiTokenCreateSchema.parse({
        ...valid,
        scopes: ['assets:read', 'assets:read', 'audit:read'],
      }).scopes,
    ).toEqual(['assets:read', 'audit:read']);
  });

  it('refuses an expiry that is not on the list, absent included', () => {
    expect(apiTokenCreateSchema.safeParse({ ...valid, expiresInDays: 45 }).success).toBe(false);
    expect(
      apiTokenCreateSchema.safeParse({ name: 'Deploy bot', scopes: ['audit:read'] }).success,
    ).toBe(false);
  });
});
