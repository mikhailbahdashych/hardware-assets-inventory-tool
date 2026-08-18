import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, auditTypeForAction, renderAuditEvent } from './audit-render.js';

describe('renderAuditEvent', () => {
  it('renders the asset lifecycle as sentences', () => {
    expect(
      renderAuditEvent({ action: 'asset.created', params: { assetName: 'MacBook Pro 14"' } }),
    ).toBe('Added MacBook Pro 14" to the inventory');
    expect(
      renderAuditEvent({
        action: 'asset.assigned',
        params: { assetName: 'MacBook Pro 14"', holderName: 'Maya Lindqvist' },
      }),
    ).toBe('Assigned MacBook Pro 14" to Maya Lindqvist');
    expect(
      renderAuditEvent({
        action: 'asset.checked_in',
        params: {
          assetName: 'MacBook Pro 14"',
          holderName: 'Elena Vasquez',
          outcome: 'offboarded',
        },
      }),
    ).toBe('Checked in MacBook Pro 14" from Elena Vasquez (offboarded)');
    expect(
      renderAuditEvent({
        action: 'asset.status_changed',
        params: { assetName: 'iPhone 15', from: 'Available', to: 'In repair' },
      }),
    ).toBe('Changed iPhone 15 from Available to In repair');
  });

  /**
   * Status events snapshot the label at write time, the same rule as
   * `holder_name_snapshot`: renaming or deleting a status must not rewrite what
   * the log already said. Everything written before that change carries slugs,
   * and those still have to read like sentences.
   */
  it('still reads events written back when statuses were slugs', () => {
    expect(
      renderAuditEvent({
        action: 'asset.status_changed',
        params: { assetName: 'iPhone 15', from: 'available', to: 'lost_stolen' },
      }),
    ).toBe('Changed iPhone 15 from Available to Lost/Stolen');
    // A slug from no vocabulary this build knows renders as itself — a log
    // that hides an event is worse than an ugly one.
    expect(
      renderAuditEvent({
        action: 'asset.status_changed',
        params: { assetName: 'iPhone 15', from: 'On loan', to: 'wiped' },
      }),
    ).toBe('Changed iPhone 15 from On loan to wiped');
  });

  /**
   * Role events snapshot the label at write time too. Everything written
   * before roles became data carries the three slugs, and those still have to
   * read like sentences.
   */
  it('still reads membership events written back when roles were slugs', () => {
    expect(
      renderAuditEvent({
        action: 'member.role_changed',
        params: { memberName: 'Grace Chen', from: 'viewer', to: 'manager' },
      }),
    ).toBe('Changed Grace Chen from Viewer to Manager');
    // A slug from no vocabulary this build knows renders as itself — a log
    // that hides an event is worse than an ugly one.
    expect(
      renderAuditEvent({
        action: 'member.role_changed',
        params: { memberName: 'Grace Chen', from: 'manager', to: 'floor_staff' },
      }),
    ).toBe('Changed Grace Chen from Manager to floor_staff');
  });

  it('lists what an edit touched, in the words the form uses', () => {
    expect(
      renderAuditEvent({
        action: 'asset.updated',
        params: { assetName: 'iPhone 15', changedFields: ['serialNumber', 'supplier'] },
      }),
    ).toBe('Updated iPhone 15 (serial number, supplier)');
    expect(
      renderAuditEvent({
        action: 'asset.updated',
        params: { assetName: 'iPhone 15', changedFields: ['custom.hostname'] },
      }),
    ).toBe('Updated iPhone 15 (hostname)');
    expect(renderAuditEvent({ action: 'asset.updated', params: { assetName: 'iPhone 15' } })).toBe(
      'Updated iPhone 15',
    );
  });

  it('renders the people and system events', () => {
    expect(
      renderAuditEvent({ action: 'employee.created', params: { employeeName: 'Maya Lindqvist' } }),
    ).toBe('Added Maya Lindqvist');
    expect(
      renderAuditEvent({
        action: 'employee.offboarding_started',
        params: { employeeName: 'Liam O’Connor', scheduledReturns: 2 },
      }),
    ).toBe('Started offboarding Liam O’Connor · 2 returns scheduled');
    expect(
      renderAuditEvent({
        action: 'employee.offboarding_started',
        params: { employeeName: 'Liam O’Connor', scheduledReturns: 0 },
      }),
    ).toBe('Started offboarding Liam O’Connor');
    expect(renderAuditEvent({ action: 'auth.login', params: {} })).toBe('Signed in');
    expect(
      renderAuditEvent({ action: 'system.setup_completed', params: { orgName: 'Acme Corp' } }),
    ).toBe('Set up Acme Corp');
  });

  it('renders the membership events, naming roles as the UI does', () => {
    expect(
      renderAuditEvent({
        action: 'member.invited',
        params: { email: 'grace@acme.io', role: 'Manager' },
      }),
    ).toBe('Invited grace@acme.io as a Manager');
    expect(
      renderAuditEvent({
        action: 'member.role_changed',
        params: { memberName: 'Grace Chen', from: 'Manager', to: 'Admin' },
      }),
    ).toBe('Changed Grace Chen from Manager to Admin');
    // A role a workspace made up reads exactly as it is called, because that
    // is what the event stored.
    expect(
      renderAuditEvent({
        action: 'member.invited',
        params: { email: 'grace@acme.io', role: 'Auditor' },
      }),
    ).toBe('Invited grace@acme.io as an Auditor');
    expect(
      renderAuditEvent({
        action: 'member.link_changed',
        params: { memberName: 'Grace Chen', employeeName: 'Grace Chen' },
      }),
    ).toBe('Linked Grace Chen to the employee record for Grace Chen');
    expect(
      renderAuditEvent({
        action: 'member.link_changed',
        params: { memberName: 'Grace Chen', employeeName: null },
      }),
    ).toBe('Unlinked Grace Chen from their employee record');
    expect(
      renderAuditEvent({ action: 'member.invite_resent', params: { email: 'grace@acme.io' } }),
    ).toBe('Resent the invitation to grace@acme.io');
    expect(
      renderAuditEvent({ action: 'member.reset_issued', params: { memberName: 'Grace Chen' } }),
    ).toBe('Issued a password reset link for Grace Chen');
    expect(
      renderAuditEvent({ action: 'member.removed', params: { memberName: 'Grace Chen' } }),
    ).toBe('Removed Grace Chen from the workspace');
    // Written by /auth/reset-password since PR 2, but nothing rendered it until
    // the activity log existed to show it.
    expect(renderAuditEvent({ action: 'auth.password_reset', params: {} })).toBe(
      'Reset their password',
    );
  });

  it('renders every workflow change as something an admin would recognise', () => {
    expect(
      renderAuditEvent({ action: 'workflow.status_created', params: { label: 'On loan' } }),
    ).toBe('Added the asset status On loan');
    expect(
      renderAuditEvent({
        action: 'workflow.status_updated',
        params: { label: 'On loan', changedFields: ['label', 'checkinTarget'] },
      }),
    ).toBe('Updated the asset status On loan (name, check-in destination)');
    expect(
      renderAuditEvent({
        action: 'workflow.status_deleted',
        params: { label: 'Lost/Stolen', migratedToLabel: null, assetCount: 0 },
      }),
    ).toBe('Deleted the asset status Lost/Stolen');
    expect(
      renderAuditEvent({
        action: 'workflow.status_deleted',
        params: { label: 'Lost/Stolen', migratedToLabel: 'Retired', assetCount: 2 },
      }),
    ).toBe('Deleted the asset status Lost/Stolen · 2 assets moved to Retired');
    expect(
      renderAuditEvent({
        action: 'workflow.status_deleted',
        params: { label: 'On loan', migratedToLabel: 'Available', assetCount: 1 },
      }),
    ).toBe('Deleted the asset status On loan · 1 asset moved to Available');
    expect(
      renderAuditEvent({
        action: 'workflow.transitions_updated',
        params: { added: 1, removed: 3 },
      }),
    ).toBe('Changed the workflow (1 transition added, 3 removed)');
    expect(renderAuditEvent({ action: 'workflow.statuses_reordered', params: {} })).toBe(
      'Reordered the asset statuses',
    );
  });

  it('renders every role change as something an admin would recognise', () => {
    expect(renderAuditEvent({ action: 'role.created', params: { label: 'Auditor' } })).toBe(
      'Added the role Auditor',
    );
    expect(
      renderAuditEvent({
        action: 'role.updated',
        params: { label: 'Auditor', changedFields: ['label', 'color'] },
      }),
    ).toBe('Updated the role Auditor (name, color)');
    expect(
      renderAuditEvent({
        action: 'role.deleted',
        params: { label: 'Auditor', migratedToLabel: null, memberCount: 0 },
      }),
    ).toBe('Deleted the role Auditor');
    expect(
      renderAuditEvent({
        action: 'role.deleted',
        params: { label: 'Auditor', migratedToLabel: 'Viewer', memberCount: 3 },
      }),
    ).toBe('Deleted the role Auditor · 3 members moved to Viewer');
    expect(
      renderAuditEvent({
        action: 'role.deleted',
        params: { label: 'Auditor', migratedToLabel: 'Viewer', memberCount: 1 },
      }),
    ).toBe('Deleted the role Auditor · 1 member moved to Viewer');
    expect(
      renderAuditEvent({ action: 'role.permissions_changed', params: { added: 2, removed: 1 } }),
    ).toBe('Changed the role permissions (2 granted, 1 revoked)');
    expect(renderAuditEvent({ action: 'role.reordered', params: {} })).toBe('Reordered the roles');
  });

  it('says which settings an admin touched', () => {
    expect(
      renderAuditEvent({
        action: 'system.settings_updated',
        params: { changedFields: ['orgName', 'assetTagPrefix'] },
      }),
    ).toBe('Updated workspace settings (organization name, asset tag prefix)');
    expect(renderAuditEvent({ action: 'system.settings_updated', params: {} })).toBe(
      'Updated workspace settings',
    );
  });

  it('never renders a blank line for an action it does not know', () => {
    expect(renderAuditEvent({ action: 'asset.teleported', params: {} })).toBe('asset.teleported');
    expect(renderAuditEvent({ action: 'asset.created', params: {} })).toBe(
      'Added an asset to the inventory',
    );
  });

  it('has a sentence for every action the API writes', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(renderAuditEvent({ action, params: {} })).not.toBe(action);
    }
  });
});

describe('auditTypeForAction', () => {
  it('maps an action onto the filter pill it belongs under', () => {
    expect(auditTypeForAction('asset.assigned')).toBe('assets');
    expect(auditTypeForAction('employee.created')).toBe('people');
    expect(auditTypeForAction('auth.login')).toBe('auth');
    expect(auditTypeForAction('member.joined')).toBe('auth');
    expect(auditTypeForAction('member.invited')).toBe('auth');
    // Roles are access control, so they file beside the member events rather
    // than under System with the workspace's other settings.
    expect(auditTypeForAction('role.created')).toBe('auth');
    expect(auditTypeForAction('role.permissions_changed')).toBe('auth');
    expect(auditTypeForAction('system.settings_updated')).toBe('system');
    expect(auditTypeForAction('system.setup_completed')).toBe('system');
    expect(auditTypeForAction('custom_field.created')).toBe('system');
    expect(auditTypeForAction('something.else')).toBe('system');
  });
});
