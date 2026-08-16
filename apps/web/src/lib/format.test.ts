import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatDuration,
  formatFullDate,
  formatMonthYear,
  formatRelativeTime,
  initials,
} from './format';

const NOW = new Date('2026-08-16T12:00:00Z');

describe('formatRelativeTime', () => {
  it('renders an em dash for missing values (never-active members)', () => {
    expect(formatRelativeTime(null, NOW)).toBe('—');
    expect(formatRelativeTime(undefined, NOW)).toBe('—');
  });

  it('renders just now under a minute', () => {
    expect(formatRelativeTime('2026-08-16T11:59:30Z', NOW)).toBe('just now');
  });

  it('renders minutes then hours like the design (26m ago, 2h ago)', () => {
    expect(formatRelativeTime('2026-08-16T11:34:00Z', NOW)).toBe('26m ago');
    expect(formatRelativeTime('2026-08-16T10:00:00Z', NOW)).toBe('2h ago');
  });

  it('renders Yesterday for the 24–48h window', () => {
    expect(formatRelativeTime('2026-08-15T10:00:00Z', NOW)).toBe('Yesterday');
  });

  it('renders day counts up to a week', () => {
    expect(formatRelativeTime('2026-08-13T12:00:00Z', NOW)).toBe('3d ago');
    expect(formatRelativeTime('2026-08-10T11:00:00Z', NOW)).toBe('6d ago');
  });

  it('switches to an absolute date after a week (Aug 9)', () => {
    expect(formatRelativeTime('2026-08-09T12:00:00Z', NOW)).toBe('Aug 9');
  });

  it('adds the year for dates outside the current year', () => {
    expect(formatRelativeTime('2025-12-20T12:00:00Z', NOW)).toBe('Dec 20, 2025');
  });
});

describe('date formats', () => {
  it('formats month-year for table cells (Mar 2023)', () => {
    expect(formatMonthYear('2023-03-12')).toBe('Mar 2023');
    expect(formatMonthYear(null)).toBe('—');
  });

  it('formats full dates for detail cards (Feb 3, 2024)', () => {
    expect(formatFullDate('2024-02-03')).toBe('Feb 3, 2024');
    expect(formatFullDate(null)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('renders years and months like the design (2 yrs 6 mo)', () => {
    expect(formatDuration('2024-02-03', '2026-08-16')).toBe('2 yrs 6 mo');
  });

  it('renders a single year without months as 1 yr', () => {
    expect(formatDuration('2025-08-16', '2026-08-16')).toBe('1 yr');
  });

  it('renders months alone under a year', () => {
    expect(formatDuration('2026-05-10', '2026-08-16')).toBe('3 mo');
  });

  it('renders days under a month and never less than 1 day', () => {
    expect(formatDuration('2026-08-04', '2026-08-16')).toBe('12 days');
    expect(formatDuration('2026-08-16', '2026-08-16')).toBe('1 day');
  });
});

describe('formatCurrency', () => {
  it('hides decimals for whole amounts like the design (€2,340)', () => {
    expect(formatCurrency(234000, 'EUR')).toBe('€2,340');
  });

  it('keeps decimals for fractional amounts', () => {
    expect(formatCurrency(123456, 'USD')).toBe('$1,234.56');
  });

  it('supports GBP and PLN', () => {
    expect(formatCurrency(58900, 'GBP')).toBe('£589');
    expect(formatCurrency(50000, 'PLN')).toContain('zł');
  });

  it('renders an em dash when the amount is unknown', () => {
    expect(formatCurrency(null, 'EUR')).toBe('—');
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Maya Lindqvist')).toBe('ML');
  });

  it('strips non-letters, so apostrophes do not leak in', () => {
    expect(initials("Liam O'Connor")).toBe('LO');
  });

  it('handles single-word names', () => {
    expect(initials('system')).toBe('S');
  });

  it('returns empty for empty input', () => {
    expect(initials('')).toBe('');
  });
});
