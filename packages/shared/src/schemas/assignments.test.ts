import { describe, expect, it } from 'vitest';
import { assignInput, checkinInput, deriveOutcome } from './assignments.js';

describe('assignInput', () => {
  it('needs a holder and a checkout date', () => {
    expect(assignInput.safeParse({ employeeId: 'emp-1', checkoutDate: '2026-03-14' }).success).toBe(
      true,
    );
    expect(assignInput.safeParse({ checkoutDate: '2026-03-14' }).success).toBe(false);
    expect(assignInput.safeParse({ employeeId: 'emp-1' }).success).toBe(false);
    expect(assignInput.safeParse({ employeeId: 'emp-1', checkoutDate: '14/03/2026' }).success).toBe(
      false,
    );
  });

  it('takes an optional expected return and note', () => {
    const parsed = assignInput.parse({
      employeeId: 'emp-1',
      checkoutDate: '2026-03-14',
      expectedReturnDate: '',
      notes: '  includes charger  ',
    });
    expect(parsed.expectedReturnDate).toBeNull();
    expect(parsed.notes).toBe('includes charger');
  });

  it('refuses an expected return that precedes the checkout', () => {
    expect(
      assignInput.safeParse({
        employeeId: 'emp-1',
        checkoutDate: '2026-03-14',
        expectedReturnDate: '2026-03-01',
      }).success,
    ).toBe(false);
  });
});

describe('checkinInput', () => {
  it('needs a return date and the status the asset lands in', () => {
    expect(
      checkinInput.safeParse({ returnDate: '2026-08-16', newStatus: 'available' }).success,
    ).toBe(true);
    expect(checkinInput.safeParse({ returnDate: '2026-08-16' }).success).toBe(false);
    expect(checkinInput.safeParse({ newStatus: 'available' }).success).toBe(false);
  });

  it('only lands in a status a returned asset can be in', () => {
    expect(
      checkinInput.safeParse({ returnDate: '2026-08-16', newStatus: 'in_repair' }).success,
    ).toBe(true);
    expect(checkinInput.safeParse({ returnDate: '2026-08-16', newStatus: 'retired' }).success).toBe(
      true,
    );
    // Checking in cannot leave the asset assigned, or mark it as never received.
    expect(
      checkinInput.safeParse({ returnDate: '2026-08-16', newStatus: 'assigned' }).success,
    ).toBe(false);
    expect(checkinInput.safeParse({ returnDate: '2026-08-16', newStatus: 'ordered' }).success).toBe(
      false,
    );
  });

  it('takes an optional condition', () => {
    expect(
      checkinInput.safeParse({
        returnDate: '2026-08-16',
        newStatus: 'available',
        condition: 'damaged',
      }).success,
    ).toBe(true);
    expect(
      checkinInput.safeParse({
        returnDate: '2026-08-16',
        newStatus: 'available',
        condition: 'chewed',
      }).success,
    ).toBe(false);
  });
});

describe('deriveOutcome', () => {
  it('records why the asset came back, not just that it did', () => {
    expect(deriveOutcome({ holderStatus: 'active', newStatus: 'available' })).toBe('returned');
    expect(deriveOutcome({ holderStatus: 'active', newStatus: 'in_repair' })).toBe('in_repair');
    expect(deriveOutcome({ holderStatus: 'active', newStatus: 'retired' })).toBe('returned');
  });

  it('puts offboarding first — it explains the return better than the destination', () => {
    expect(deriveOutcome({ holderStatus: 'offboarding', newStatus: 'available' })).toBe(
      'offboarded',
    );
    expect(deriveOutcome({ holderStatus: 'offboarding', newStatus: 'in_repair' })).toBe(
      'offboarded',
    );
  });

  it('falls back to "returned" when the holder is no longer on file', () => {
    expect(deriveOutcome({ holderStatus: null, newStatus: 'available' })).toBe('returned');
  });
});
