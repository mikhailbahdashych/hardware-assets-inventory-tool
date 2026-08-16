import { describe, expect, it } from 'vitest';
import { centsToInputValue, parsePriceToCents } from './money.js';

describe('parsePriceToCents', () => {
  it('reads plain and decimal amounts as integer cents', () => {
    expect(parsePriceToCents('2340')).toEqual({ ok: true, cents: 234000 });
    expect(parsePriceToCents('2340.50')).toEqual({ ok: true, cents: 234050 });
    expect(parsePriceToCents('0.05')).toEqual({ ok: true, cents: 5 });
  });

  it('tolerates the shapes people paste: symbols, spaces and thousands separators', () => {
    expect(parsePriceToCents('€ 2,340.00')).toEqual({ ok: true, cents: 234000 });
    expect(parsePriceToCents('$1 299')).toEqual({ ok: true, cents: 129900 });
    expect(parsePriceToCents('  749.99  ')).toEqual({ ok: true, cents: 74999 });
  });

  it('reads a comma decimal separator when it is not a thousands separator', () => {
    expect(parsePriceToCents('2340,50')).toEqual({ ok: true, cents: 234050 });
    expect(parsePriceToCents('1.299,00')).toEqual({ ok: true, cents: 129900 });
  });

  it('treats blank input as "no price"', () => {
    expect(parsePriceToCents('')).toEqual({ ok: true, cents: null });
    expect(parsePriceToCents('   ')).toEqual({ ok: true, cents: null });
  });

  it('rounds to the nearest cent rather than truncating', () => {
    expect(parsePriceToCents('10.005')).toEqual({ ok: true, cents: 1001 });
  });

  it('rejects text, negatives and absurd amounts', () => {
    expect(parsePriceToCents('free').ok).toBe(false);
    expect(parsePriceToCents('-10').ok).toBe(false);
    expect(parsePriceToCents('999999999999').ok).toBe(false);
  });
});

describe('centsToInputValue', () => {
  it('round-trips through the form input', () => {
    expect(centsToInputValue(234000)).toBe('2340.00');
    expect(centsToInputValue(74999)).toBe('749.99');
    expect(centsToInputValue(null)).toBe('');
    expect(parsePriceToCents(centsToInputValue(129900))).toEqual({ ok: true, cents: 129900 });
  });
});
