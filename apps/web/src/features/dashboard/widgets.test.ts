import { describe, expect, it } from 'vitest';
import { isWidgetVisible, warrantyUrgency } from './widgets';

describe('isWidgetVisible', () => {
  it('shows a widget nobody has an opinion about', () => {
    expect(isWidgetVisible({}, 'kpi')).toBe(true);
    expect(isWidgetVisible({ warranty: false }, 'kpi')).toBe(true);
  });

  it('hides only what was explicitly turned off', () => {
    expect(isWidgetVisible({ kpi: false }, 'kpi')).toBe(false);
    expect(isWidgetVisible({ kpi: true }, 'kpi')).toBe(true);
  });
});

describe('warrantyUrgency', () => {
  it('turns red under a month and amber up to three', () => {
    expect(warrantyUrgency(0)).toBe('err');
    expect(warrantyUrgency(29)).toBe('err');
    expect(warrantyUrgency(30)).toBe('warn');
    expect(warrantyUrgency(90)).toBe('warn');
  });
});
