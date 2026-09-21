import { describe, expect, it } from 'vitest';
import { escapeLike } from './search.js';

describe('escapeLike', () => {
  it('leaves an ordinary needle alone', () => {
    expect(escapeLike('MacBook Pro 14"')).toBe('MacBook Pro 14"');
  });

  it("escapes LIKE's own wildcards, so they match themselves", () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('AST_1')).toBe('AST\\_1');
  });

  it('escapes the escape character first, so it cannot escape the next one', () => {
    expect(escapeLike('a\\%b')).toBe('a\\\\\\%b');
  });
});
