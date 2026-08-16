import { describe, expect, it } from 'vitest';
import { computeNextTag } from './tag.js';

describe('computeNextTag', () => {
  it('starts at 0001 for an empty inventory', () => {
    expect(computeNextTag('AST', [])).toBe('AST-0001');
  });

  it('increments the highest existing number, zero-padded to 4', () => {
    expect(computeNextTag('AST', ['AST-0142', 'AST-0223', 'AST-0089'])).toBe('AST-0224');
  });

  it('only considers tags with the current prefix', () => {
    expect(computeNextTag('AST', ['OLD-9000', 'AST-0007', 'misc'])).toBe('AST-0008');
  });

  it('handles numbers beyond four digits without truncating', () => {
    expect(computeNextTag('AST', ['AST-12000'])).toBe('AST-12001');
  });

  it('respects a custom prefix from settings', () => {
    expect(computeNextTag('ACME', ['ACME-0009'])).toBe('ACME-0010');
  });
});
