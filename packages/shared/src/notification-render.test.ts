import { describe, expect, it } from 'vitest';
import { renderNotification } from './notification-render';

describe('renderNotification', () => {
  it('renders every kind as the sentence the inbox shows', () => {
    expect(
      renderNotification({
        kind: 'warranty.expiring',
        params: { assetName: 'MacBook Pro 14"', assetTag: 'AST-0042', days: 12 },
      }),
    ).toBe('Warranty for AST-0042 · MacBook Pro 14" expires in 12 days');
    expect(
      renderNotification({
        kind: 'warranty.expiring',
        params: { assetName: 'Dock', assetTag: 'AST-0001', days: 1 },
      }),
    ).toBe('Warranty for AST-0001 · Dock expires tomorrow');
    expect(
      renderNotification({
        kind: 'warranty.expiring',
        params: { assetName: 'Dock', assetTag: 'AST-0001', days: 0 },
      }),
    ).toBe('Warranty for AST-0001 · Dock expires today');
    expect(
      renderNotification({
        kind: 'return.due',
        params: { assetName: 'iPad', assetTag: 'AST-0007', date: '2026-09-24', overdue: false },
      }),
    ).toBe('Your return of AST-0007 · iPad is due 24 Sep 2026');
    expect(
      renderNotification({
        kind: 'return.due',
        params: { assetName: 'iPad', assetTag: 'AST-0007', date: '2026-09-20', overdue: true },
      }),
    ).toBe('Your return of AST-0007 · iPad was due 20 Sep 2026');
    expect(
      renderNotification({
        kind: 'assignment.received',
        params: { assetName: 'iPad', assetTag: 'AST-0007' },
      }),
    ).toBe('You were handed AST-0007 · iPad');
    expect(
      renderNotification({
        kind: 'assignment.checked_in',
        params: { assetName: 'iPad', assetTag: 'AST-0007' },
      }),
    ).toBe('AST-0007 · iPad was checked in from you');
  });

  it('renders an unknown kind as itself rather than hiding the row', () => {
    // The same deliberate fallback as the audit renderer: an inbox that hides
    // items is worse than an ugly one.
    expect(renderNotification({ kind: 'mystery.kind', params: {} })).toBe('mystery.kind');
  });
});
