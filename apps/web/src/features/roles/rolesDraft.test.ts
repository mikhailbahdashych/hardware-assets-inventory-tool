import { describe, expect, it } from 'vitest';
import { ACTIONS, type WorkspaceRole } from '@inventory/shared';
import { draftChanged, draftFromRoles, draftKey, grantsFromDraft } from './rolesDraft';

const role = (
  id: string,
  permissions: WorkspaceRole['permissions'],
  isSystem = false,
): WorkspaceRole => ({
  id,
  label: id,
  description: null,
  color: 'neut',
  isSystem,
  sortOrder: 0,
  memberCount: 0,
  permissions,
});

const ROLES: WorkspaceRole[] = [
  role('admin', [...ACTIONS], true),
  role('manager', ['assets.create', 'assets.edit']),
  role('viewer', []),
];

describe('draftKey', () => {
  it('names one role holding one action', () => {
    expect(draftKey('manager', 'assets.create')).toBe('manager:assets.create');
    expect(draftKey('manager', 'assets.edit')).not.toBe(draftKey('manager', 'assets.create'));
  });
});

describe('the draft round trip', () => {
  it('turns the stored grants into a set and back into pairs', () => {
    const draft = draftFromRoles(ROLES);
    expect(draft.has(draftKey('manager', 'assets.create'))).toBe(true);
    expect(grantsFromDraft(draft)).toEqual(
      expect.arrayContaining([
        { role: 'manager', action: 'assets.create' },
        { role: 'manager', action: 'assets.edit' },
      ]),
    );
    expect(grantsFromDraft(draft)).toHaveLength(2);
  });

  it('leaves the system role out — its set is every action, and it is not stored', () => {
    const draft = draftFromRoles(ROLES);
    expect([...draft].some((key) => key.startsWith('admin:'))).toBe(false);
  });

  it('survives a role id with an underscore in it', () => {
    const draft = draftFromRoles([role('read_only', ['audit.view'])]);
    expect(grantsFromDraft(draft)).toEqual([{ role: 'read_only', action: 'audit.view' }]);
  });

  it('refuses a key nothing in this file could have written', () => {
    expect(() => grantsFromDraft(new Set(['manager']))).toThrow(/not a permission key/);
    expect(() => grantsFromDraft(new Set(['manager:assets.explode']))).toThrow(
      /not a permission key/,
    );
    expect(() => grantsFromDraft(new Set([':audit.view']))).toThrow(/not a permission key/);
  });
});

describe('draftChanged', () => {
  it('is false for the same grants, whatever order they were built in', () => {
    const stored = draftFromRoles(ROLES);
    const draft = draftFromRoles([...ROLES].reverse());
    expect(draftChanged(stored, draft)).toBe(false);
  });

  it('is true when a box is checked or unchecked', () => {
    const stored = draftFromRoles(ROLES);

    const revoked = new Set(stored);
    revoked.delete(draftKey('manager', 'assets.edit'));
    expect(draftChanged(stored, revoked)).toBe(true);

    const granted = new Set(stored);
    granted.add(draftKey('viewer', 'audit.view'));
    expect(draftChanged(stored, granted)).toBe(true);
  });

  it('is true when one grant is swapped for another, not just counted', () => {
    const stored = draftFromRoles(ROLES);
    const swapped = new Set(stored);
    swapped.delete(draftKey('manager', 'assets.edit'));
    swapped.add(draftKey('viewer', 'assets.edit'));
    expect(swapped.size).toBe(stored.size);
    expect(draftChanged(stored, swapped)).toBe(true);
  });
});
