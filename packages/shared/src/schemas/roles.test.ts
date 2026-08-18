import { describe, expect, it } from 'vitest';
import { statusSlug } from './workflow.js';
import {
  permissionsPutSchema,
  roleCreateSchema,
  roleOrderSchema,
  rolePatchSchema,
  roleSlug,
} from './roles.js';

describe('roleCreateSchema', () => {
  it('takes a label and a color, with no description at all', () => {
    expect(roleCreateSchema.parse({ label: '  Auditor  ', color: 'warn' })).toEqual({
      label: 'Auditor',
      description: null,
      color: 'warn',
    });
  });

  it('stores a blank description as nothing, never as an empty string', () => {
    expect(roleCreateSchema.parse({ label: 'Auditor', description: '   ', color: 'warn' })).toEqual(
      {
        label: 'Auditor',
        description: null,
        color: 'warn',
      },
    );
  });

  it('refuses a blank label, an overlong one, and a color outside the six', () => {
    expect(roleCreateSchema.safeParse({ label: '   ', color: 'ok' }).success).toBe(false);
    expect(roleCreateSchema.safeParse({ label: 'x'.repeat(41), color: 'ok' }).success).toBe(false);
    expect(roleCreateSchema.safeParse({ label: 'x'.repeat(40), color: 'ok' }).success).toBe(true);
    expect(roleCreateSchema.safeParse({ label: 'Auditor', color: 'purple' }).success).toBe(false);
    expect(
      roleCreateSchema.safeParse({ label: 'Auditor', description: 'x'.repeat(121), color: 'ok' })
        .success,
    ).toBe(false);
  });

  it('says what a nameless role is missing, in the words the form shows', () => {
    const result = roleCreateSchema.safeParse({ label: '', color: 'ok' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toBe('Give the role a name.');
  });
});

describe('rolePatchSchema', () => {
  it('accepts any subset, including nothing at all', () => {
    expect(rolePatchSchema.parse({})).toEqual({});
    expect(rolePatchSchema.parse({ color: 'err' })).toEqual({ color: 'err' });
    expect(rolePatchSchema.parse({ label: ' Auditor ', description: 'Reads the books' })).toEqual({
      label: 'Auditor',
      description: 'Reads the books',
    });
  });

  /** Present-but-blank is the design's "clear it"; absent is "leave it alone". */
  it('clears a description that is submitted blank', () => {
    expect(rolePatchSchema.parse({ description: '' })).toEqual({ description: null });
  });

  it('applies the same bounds as a create to whatever it is given', () => {
    expect(rolePatchSchema.safeParse({ label: '' }).success).toBe(false);
    expect(rolePatchSchema.safeParse({ color: 'burgundy' }).success).toBe(false);
  });
});

describe('permissionsPutSchema', () => {
  const grant = (index: number) => ({ role: `role${index}`, action: 'assets.create' as const });

  it('takes the whole grant set, the empty one included', () => {
    expect(permissionsPutSchema.parse({ grants: [] })).toEqual({ grants: [] });
    expect(
      permissionsPutSchema.parse({ grants: [{ role: 'manager', action: 'assets.edit' }] }).grants,
    ).toHaveLength(1);
  });

  it('refuses an action this build does not declare, and a nameless role', () => {
    expect(
      permissionsPutSchema.safeParse({ grants: [{ role: 'manager', action: 'assets.teleport' }] })
        .success,
    ).toBe(false);
    expect(
      permissionsPutSchema.safeParse({ grants: [{ role: '', action: 'assets.edit' }] }).success,
    ).toBe(false);
  });

  it('caps the payload at 400 grants', () => {
    const grants = Array.from({ length: 400 }, (_, index) => grant(index));
    expect(permissionsPutSchema.safeParse({ grants }).success).toBe(true);
    expect(permissionsPutSchema.safeParse({ grants: [...grants, grant(400)] }).success).toBe(false);
  });
});

describe('roleOrderSchema', () => {
  it('takes a non-empty id list no longer than a workspace may hold', () => {
    expect(roleOrderSchema.parse({ order: ['admin'] }).order).toEqual(['admin']);
    expect(roleOrderSchema.safeParse({ order: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 11 }, (_, index) => `r${index}`);
    expect(roleOrderSchema.safeParse({ order: tooMany }).success).toBe(false);
  });
});

describe('roleSlug', () => {
  it('derives the same shape of id a status does, from the same labels', () => {
    for (const label of [
      'Read only',
      'Wiped & Ready',
      'In-Repair',
      '  Lost/Stolen  ',
      '—',
      '!!!',
    ]) {
      expect(roleSlug(label), label).toBe(statusSlug(label));
    }
    expect(roleSlug('Read only')).toBe('read_only');
  });

  it('reproduces every default role id from its own label', () => {
    expect(roleSlug('Admin')).toBe('admin');
    expect(roleSlug('Manager')).toBe('manager');
    expect(roleSlug('Viewer')).toBe('viewer');
  });
});
