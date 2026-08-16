import { describe, expect, it } from 'vitest';
import { AVATAR_PALETTE, avatarColor } from './avatar';

describe('AVATAR_PALETTE', () => {
  it('is the exact nine-color palette from the design', () => {
    expect(AVATAR_PALETTE).toEqual([
      '#7c66dc',
      '#0d9488',
      '#d97706',
      '#2563eb',
      '#db2777',
      '#059669',
      '#dc2626',
      '#6366f1',
      '#b45309',
    ]);
  });
});

describe('avatarColor', () => {
  it('always returns a palette color', () => {
    for (const id of ['a', 'maya', 'f3c2b1aa-1111-2222-3333-444455556666']) {
      expect(AVATAR_PALETTE).toContain(avatarColor(id));
    }
  });

  it('is deterministic for the same id', () => {
    expect(avatarColor('emp-42')).toBe(avatarColor('emp-42'));
  });

  it('spreads different ids across multiple colors', () => {
    const ids = Array.from({ length: 24 }, (_, i) => `employee-${i}`);
    const colors = new Set(ids.map(avatarColor));
    expect(colors.size).toBeGreaterThan(3);
  });
});
