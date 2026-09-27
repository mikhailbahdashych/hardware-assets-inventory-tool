import { describe, expect, it } from 'vitest';
import { isCalendarDate, nullableDate, requiredDate } from './common.js';

// A date-only value has to be a day the calendar has, not merely eight digits
// and two dashes: `2026-13-45` used to pass, get stored, and take the Assets
// pages down for everybody when the browser tried to draw it.

describe('isCalendarDate', () => {
  it.each(['2026-01-31', '2024-02-29', '2000-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(['2026-13-45', '2026-02-30', '2023-02-29', '1900-02-29', '2026-04-31', '2026-00-10'])(
    'refuses %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  it('refuses anything not shaped YYYY-MM-DD', () => {
    expect(isCalendarDate('12/03/2023')).toBe(false);
    expect(isCalendarDate('2023-3-12')).toBe(false);
  });
});

describe('the date schemas', () => {
  it('refuses an impossible day with a sentence, not a regex', () => {
    const result = nullableDate.safeParse('2026-02-30');
    expect(result.success).toBe(false);
    expect(result.error!.issues).toHaveLength(1);
    expect(result.error!.issues[0]!.message).toBe(
      'That day is not on the calendar — check the month and the day.',
    );
    expect(requiredDate.safeParse('2026-13-45').success).toBe(false);
  });

  it('still says what the format is when the shape is wrong', () => {
    const result = requiredDate.safeParse('Jan 2023');
    expect(result.error!.issues.map((issue) => issue.message)).toEqual([
      'Use the format YYYY-MM-DD',
    ]);
  });

  it('keeps a leap day and a blank', () => {
    expect(nullableDate.parse('2024-02-29')).toBe('2024-02-29');
    expect(requiredDate.parse('2024-02-29')).toBe('2024-02-29');
    expect(nullableDate.parse('')).toBeNull();
  });
});
