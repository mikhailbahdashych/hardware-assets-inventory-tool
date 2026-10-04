import { describe, expect, it } from 'vitest';
import { survivor } from './survivor';

describe('survivor', () => {
  it('prefers the next row, then the previous, then nobody', () => {
    expect(survivor(['a', 'b', 'c'], 'a')).toBe('b');
    expect(survivor(['a', 'b', 'c'], 'c')).toBe('b');
    expect(survivor(['a'], 'a')).toBeNull();
  });
});
