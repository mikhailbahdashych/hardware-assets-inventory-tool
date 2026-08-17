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

  it('rejects an unknown role', () => {
    expect(inviteInput.safeParse({ email: 'a@acme.io', role: 'owner' }).success).toBe(false);
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
