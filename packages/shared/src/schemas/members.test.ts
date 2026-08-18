import { describe, expect, it } from 'vitest';
import { inviteInput, memberPatchInput, workspaceDeleteInput } from './members.js';

describe('inviteInput', () => {
  it('lowercases the email and defaults the optional half of the form', () => {
    const parsed = inviteInput.parse({ email: 'Person@Acme.IO', role: 'manager' });
    expect(parsed).toEqual({
      email: 'person@acme.io',
      role: 'manager',
      employeeId: null,
      sendEmail: true,
    });
  });

  it('carries the employee link when the form offers one', () => {
    const parsed = inviteInput.parse({
      email: 'maya@acme.io',
      role: 'viewer',
      employeeId: 'emp-1',
      sendEmail: false,
    });
    expect(parsed.employeeId).toBe('emp-1');
    expect(parsed.sendEmail).toBe(false);
  });

  /**
   * A role this schema has never heard of is fine here on purpose: roles are
   * rows a workspace edits, so no build can list them. Whether the id names one
   * is a fact about the database, and the members service asks the roles table
   * — a 422 naming the `role` field, from there rather than from here.
   */
  it('takes any non-empty role id, and refuses an empty one', () => {
    expect(inviteInput.safeParse({ email: 'a@acme.io', role: 'floor_staff' }).success).toBe(true);
    expect(inviteInput.safeParse({ email: 'a@acme.io', role: '' }).success).toBe(false);
    expect(inviteInput.safeParse({ email: 'a@acme.io' }).success).toBe(false);
  });
});

describe('memberPatchInput', () => {
  it('leaves absent fields alone and lets an explicit null clear the link', () => {
    expect(memberPatchInput.parse({})).toEqual({});
    expect(memberPatchInput.parse({ employeeId: null })).toEqual({ employeeId: null });
    expect(memberPatchInput.parse({ role: 'admin' })).toEqual({ role: 'admin' });
  });
});

describe('workspaceDeleteInput', () => {
  it('requires the confirmation text the dialog asks for', () => {
    expect(workspaceDeleteInput.parse({ confirmText: 'Acme Corp' })).toEqual({
      confirmText: 'Acme Corp',
    });
    expect(workspaceDeleteInput.safeParse({ confirmText: '' }).success).toBe(false);
  });
});
