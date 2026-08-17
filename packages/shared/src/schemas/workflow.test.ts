import { describe, expect, it } from 'vitest';
import {
  statusCreateSchema,
  statusOrderSchema,
  statusPatchSchema,
  statusSlug,
  transitionsPutSchema,
} from './workflow.js';

describe('statusCreateSchema', () => {
  it('takes a label and a color, defaulting both flags to off', () => {
    const parsed = statusCreateSchema.parse({ label: '  On loan  ', color: 'info' });
    expect(parsed).toEqual({
      label: 'On loan',
      color: 'info',
      assignableFrom: false,
      checkinTarget: false,
    });
  });

  it('refuses a blank label, an overlong one, and a color outside the six', () => {
    expect(statusCreateSchema.safeParse({ label: '   ', color: 'ok' }).success).toBe(false);
    expect(statusCreateSchema.safeParse({ label: 'x'.repeat(41), color: 'ok' }).success).toBe(
      false,
    );
    expect(statusCreateSchema.safeParse({ label: 'x'.repeat(40), color: 'ok' }).success).toBe(true);
    expect(statusCreateSchema.safeParse({ label: 'On loan', color: 'purple' }).success).toBe(false);
  });

  it('says what a nameless status is missing, in the words the form shows', () => {
    const result = statusCreateSchema.safeParse({ label: '', color: 'ok' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toBe('Give the status a name.');
  });
});

describe('statusPatchSchema', () => {
  it('accepts any subset, including nothing at all', () => {
    expect(statusPatchSchema.parse({})).toEqual({});
    expect(statusPatchSchema.parse({ checkinTarget: true })).toEqual({ checkinTarget: true });
    expect(statusPatchSchema.parse({ label: ' Retired ', color: 'neut' })).toEqual({
      label: 'Retired',
      color: 'neut',
    });
  });

  it('applies the same bounds as a create to whatever it is given', () => {
    expect(statusPatchSchema.safeParse({ label: '' }).success).toBe(false);
    expect(statusPatchSchema.safeParse({ color: 'burgundy' }).success).toBe(false);
    expect(statusPatchSchema.safeParse({ assignableFrom: 'yes' }).success).toBe(false);
  });
});

describe('transitionsPutSchema', () => {
  const edge = (index: number) => ({ from: `a${index}`, to: `b${index}` });

  it('takes the whole graph, empty graph included', () => {
    expect(transitionsPutSchema.parse({ transitions: [] })).toEqual({ transitions: [] });
    expect(
      transitionsPutSchema.parse({ transitions: [{ from: 'available', to: 'retired' }] })
        .transitions,
    ).toHaveLength(1);
  });

  it('caps the payload at 400 edges', () => {
    const edges = Array.from({ length: 400 }, (_, index) => edge(index));
    expect(transitionsPutSchema.safeParse({ transitions: edges }).success).toBe(true);
    expect(transitionsPutSchema.safeParse({ transitions: [...edges, edge(400)] }).success).toBe(
      false,
    );
  });

  it('refuses an endpoint that is not a slug at all', () => {
    expect(transitionsPutSchema.safeParse({ transitions: [{ from: '', to: 'x' }] }).success).toBe(
      false,
    );
    expect(transitionsPutSchema.safeParse({ transitions: [{ from: 'x' }] }).success).toBe(false);
  });
});

describe('statusOrderSchema', () => {
  it('takes a non-empty id list no longer than a workspace may hold', () => {
    expect(statusOrderSchema.parse({ ids: ['available'] }).ids).toEqual(['available']);
    expect(statusOrderSchema.safeParse({ ids: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 21 }, (_, index) => `s${index}`);
    expect(statusOrderSchema.safeParse({ ids: tooMany }).success).toBe(false);
  });
});

describe('statusSlug', () => {
  it('lowercases, joins runs of punctuation with one underscore, and trims them', () => {
    expect(statusSlug('On loan')).toBe('on_loan');
    expect(statusSlug('Wiped & Ready')).toBe('wiped_ready');
    expect(statusSlug('In-Repair')).toBe('in_repair');
    expect(statusSlug('  Lost/Stolen  ')).toBe('lost_stolen');
  });

  it('returns nothing when nothing usable survives, which the caller reports', () => {
    expect(statusSlug('—')).toBe('');
    expect(statusSlug('   ')).toBe('');
    expect(statusSlug('!!!')).toBe('');
  });

  it('reproduces every default status slug from its own label', () => {
    expect(statusSlug('Available')).toBe('available');
    expect(statusSlug('Assigned')).toBe('assigned');
    expect(statusSlug('Ordered')).toBe('ordered');
  });
});
