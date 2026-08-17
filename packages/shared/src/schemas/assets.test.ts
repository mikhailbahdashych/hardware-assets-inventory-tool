import { describe, expect, it } from 'vitest';
import { assetCreateInput, assetPatchInput } from './assets.js';

const MINIMAL = { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' };

describe('assetCreateInput', () => {
  it('accepts the minimum a form can submit', () => {
    const parsed = assetCreateInput.parse(MINIMAL);
    expect(parsed.name).toBe('MacBook Pro 14"');
    expect(parsed.assetTag).toBeUndefined();
  });

  it('turns blank optional text into null so the column clears', () => {
    const parsed = assetCreateInput.parse({ ...MINIMAL, serialNumber: '  ', supplier: '' });
    expect(parsed.serialNumber).toBeNull();
    expect(parsed.supplier).toBeNull();
  });

  it('drops a blank asset tag so the server generates the next one', () => {
    expect(assetCreateInput.parse({ ...MINIMAL, assetTag: '   ' }).assetTag).toBeUndefined();
    expect(assetCreateInput.parse({ ...MINIMAL, assetTag: 'AST-0224' }).assetTag).toBe('AST-0224');
  });

  it('rejects unknown categories and statuses', () => {
    expect(assetCreateInput.safeParse({ ...MINIMAL, category: 'servers' }).success).toBe(false);
    expect(assetCreateInput.safeParse({ ...MINIMAL, status: 'on_fire' }).success).toBe(false);
  });

  it('requires a name', () => {
    expect(assetCreateInput.safeParse({ ...MINIMAL, name: '   ' }).success).toBe(false);
  });

  it('accepts date-only strings and rejects anything else', () => {
    expect(assetCreateInput.safeParse({ ...MINIMAL, purchaseDate: '2024-03-12' }).success).toBe(
      true,
    );
    expect(assetCreateInput.parse({ ...MINIMAL, purchaseDate: '' }).purchaseDate).toBeNull();
    expect(assetCreateInput.safeParse({ ...MINIMAL, purchaseDate: '12/03/2024' }).success).toBe(
      false,
    );
    expect(
      assetCreateInput.safeParse({ ...MINIMAL, warrantyUntil: '2026-08-16T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('takes money as integer cents only', () => {
    expect(assetCreateInput.safeParse({ ...MINIMAL, purchasePriceCents: 234000 }).success).toBe(
      true,
    );
    expect(assetCreateInput.safeParse({ ...MINIMAL, purchasePriceCents: 2340.5 }).success).toBe(
      false,
    );
    expect(assetCreateInput.safeParse({ ...MINIMAL, purchasePriceCents: -1 }).success).toBe(false);
  });

  it('requires a holder when the asset starts out assigned', () => {
    expect(assetCreateInput.safeParse({ ...MINIMAL, status: 'assigned' }).success).toBe(false);
    const parsed = assetCreateInput.parse({
      ...MINIMAL,
      status: 'assigned',
      assignedToEmployeeId: 'emp-1',
      checkoutDate: '2024-03-12',
    });
    expect(parsed.assignedToEmployeeId).toBe('emp-1');
  });

  it('carries custom field values keyed by definition key', () => {
    const parsed = assetCreateInput.parse({
      ...MINIMAL,
      customValues: { mdm_enrolled: 'true', hostname: 'maya-mbp', cost_center: null },
    });
    expect(parsed.customValues).toEqual({
      mdm_enrolled: 'true',
      hostname: 'maya-mbp',
      cost_center: null,
    });
  });
});

describe('assetPatchInput', () => {
  it('accepts an empty patch and single-field patches', () => {
    expect(assetPatchInput.safeParse({}).success).toBe(true);
    expect(assetPatchInput.safeParse({ name: 'Renamed' }).success).toBe(true);
  });

  it('distinguishes "leave alone" (absent) from "clear" (null)', () => {
    const parsed = assetPatchInput.parse({ supplier: null });
    expect(parsed.supplier).toBeNull();
    expect('notes' in parsed).toBe(false);
  });

  it('has no holder fields — assigning is not an edit', () => {
    const parsed = assetPatchInput.parse({
      assignedToEmployeeId: 'emp-1',
    } as Record<string, unknown>);
    expect('assignedToEmployeeId' in parsed).toBe(false);
  });
});
