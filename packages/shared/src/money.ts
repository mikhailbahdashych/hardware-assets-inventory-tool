// Money is integer cents everywhere — in the database, on the wire, and in
// these helpers. Only the form input and the CSV column are decimal strings,
// so this is the one place a decimal is turned into cents (and back).

/** €1,000,000.00 — a ceiling that keeps a typo from becoming a plausible row. */
export const MAX_PRICE_CENTS = 100_000_000;

export type PriceParse = { ok: true; cents: number | null } | { ok: false; reason: string };

const NOT_A_NUMBER = 'Enter an amount like 1299.00.';

/**
 * Reads what people actually type or paste — "€ 2,340.00", "1.299,00", "749.99"
 * — into integer cents. Blank means "no price". Arithmetic stays on integers so
 * amounts like 10.005 round to the nearest cent instead of drifting in binary
 * floating point.
 */
export function parsePriceToCents(raw: string): PriceParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, cents: null };

  // Drop spaces and any leading currency symbol, then insist on digits only.
  const cleaned = trimmed.replace(/[\s\u00a0\u202f]/g, '').replace(/^[^\d.,-]*/, '');
  if (!/^-?[\d.,]+$/.test(cleaned)) return { ok: false, reason: NOT_A_NUMBER };
  if (cleaned.startsWith('-')) return { ok: false, reason: 'A price cannot be negative.' };

  const [whole, fraction = ''] = normalizeSeparators(cleaned).split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return { ok: false, reason: NOT_A_NUMBER };

  let cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  if (Number(fraction[2] ?? 0) >= 5) cents += 1;

  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS) {
    return { ok: false, reason: 'That price is larger than this field allows.' };
  }
  return { ok: true, cents };
}

/** Cents back into the decimal string a form input shows. */
export function centsToInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/**
 * Resolves the "." vs "," ambiguity: when both appear the last one is the
 * decimal separator; a lone comma is a thousands separator only when it groups
 * exactly three digits ("2,340"), otherwise it is a decimal comma ("2340,50").
 */
function normalizeSeparators(value: string): string {
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    return value.split(thousands).join('').replace(decimal, '.');
  }

  if (lastComma >= 0) {
    const parts = value.split(',');
    const grouped = parts.length > 2 || parts[parts.length - 1].length === 3;
    return grouped ? parts.join('') : parts.join('.');
  }

  const parts = value.split('.');
  return parts.length > 2 ? parts.join('') : value;
}
