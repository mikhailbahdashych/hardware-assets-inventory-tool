import { describe, expect, it } from 'vitest';
import { humanizeTag } from './spec';

describe('humanizeTag', () => {
  it('reads a slug as words, in sentence case', () => {
    expect(humanizeTag('assets')).toBe('Assets');
    expect(humanizeTag('custom-fields')).toBe('Custom fields');
    expect(humanizeTag('api_tokens')).toBe('Api tokens');
  });

  it('leaves the rest of a tag that is already words alone', () => {
    // Lowercasing the tail would turn an acronym into a word.
    expect(humanizeTag('API tokens')).toBe('API tokens');
  });
});
