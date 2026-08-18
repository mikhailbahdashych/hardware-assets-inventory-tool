import { DEFAULT_ASSET_STATUSES, type AuditType } from './enums.js';
import { DEFAULT_ROLES } from './rbac.js';
import type { AuditParams, RenderableAuditEvent } from './types/audit.js';

// Audit events are stored structured — an action plus params with name
// snapshots — and rendered to sentences here. One renderer serves the per-asset
// trail, the activity log and the CSV export, so they can never drift apart.

const text = (params: AuditParams, key: string, fallback: string): string => {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
};

/** The labels the six default slugs were written with, for the fallback below. */
const LEGACY_STATUS_LABELS = new Map<string, string>(
  DEFAULT_ASSET_STATUSES.map((entry) => [entry.id, entry.label]),
);

/**
 * A status as the event recorded it. Events written since statuses became data
 * carry the **label** — snapshotted at write time, the same rule as
 * `holder_name_snapshot`, so renaming or deleting a status never rewrites what
 * the log already said. This is purely the fallback for what came before:
 * older events carry slugs, and the six defaults are the only slugs that ever
 * reached the log through a build that stored them.
 *
 * Anything else renders as itself. Same rule as the unknown-action fallback
 * below: a log that hides an event is worse than an ugly one.
 */
const status = (params: AuditParams, key: string): string => {
  const value = params[key];
  return typeof value === 'string' ? (LEGACY_STATUS_LABELS.get(value) ?? value) : 'unknown';
};

/** The labels the three default slugs were written with, for the fallback below. */
const LEGACY_ROLE_LABELS = new Map<string, string>(
  DEFAULT_ROLES.map((entry) => [entry.id, entry.label]),
);

/**
 * A role as the event recorded it. Events written since roles became data carry
 * the **label**, snapshotted at write time — the same rule as `status` above,
 * so renaming or deleting a role never rewrites what the log already said.
 * This is purely the fallback for what came before: older events carry slugs,
 * and the three defaults are the only slugs that ever reached the log through a
 * build that stored them. Anything else renders as itself.
 */
const role = (params: AuditParams, key: string): string => {
  const value = params[key];
  return typeof value === 'string' ? (LEGACY_ROLE_LABELS.get(value) ?? value) : 'unknown';
};

/** Field names as the forms say them, so a log line reads like the UI. */
const FIELD_LABELS: Record<string, string> = {
  label: 'name',
  assignableFrom: 'can be assigned from',
  checkinTarget: 'check-in destination',
  assetTag: 'asset tag',
  serialNumber: 'serial number',
  purchaseDate: 'purchase date',
  purchasePriceCents: 'price',
  warrantyUntil: 'warranty',
  firstName: 'first name',
  lastName: 'last name',
  jobTitle: 'job title',
  employeeCode: 'employee ID',
  startDate: 'start date',
  orgName: 'organization name',
  warrantyLeadDays: 'warranty alert lead time',
  logRetentionMonths: 'activity log retention',
  emailWarrantyAlerts: 'warranty alert emails',
  emailReturnReminders: 'return reminder emails',
  emailInvites: 'member invite emails',
  emailWeeklyDigest: 'weekly digest emails',
};

function fieldList(params: AuditParams): string {
  const fields = params.changedFields;
  if (!Array.isArray(fields) || fields.length === 0) return '';
  const names = fields
    .filter((field): field is string => typeof field === 'string')
    .map((field) =>
      field.startsWith('custom.')
        ? field.slice('custom.'.length).replace(/_/g, ' ')
        : // Not every column earns a hand-written label; the rest are humanized
          // from the field name so a new column never renders as a blank.
          (FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, ' $1').toLowerCase()),
    );
  return names.length > 0 ? ` (${names.join(', ')})` : '';
}

const RENDERERS: Record<string, (params: AuditParams) => string> = {
  'asset.created': (p) => `Added ${text(p, 'assetName', 'an asset')} to the inventory`,
  'asset.updated': (p) => `Updated ${text(p, 'assetName', 'an asset')}${fieldList(p)}`,
  'asset.status_changed': (p) =>
    `Changed ${text(p, 'assetName', 'an asset')} from ${status(p, 'from')} to ${status(p, 'to')}`,
  'asset.deleted': (p) => `Deleted ${text(p, 'assetName', 'an asset')}`,
  'asset.assigned': (p) =>
    `Assigned ${text(p, 'assetName', 'an asset')} to ${text(p, 'holderName', 'somebody')}`,
  'asset.checked_in': (p) => {
    const outcome = typeof p.outcome === 'string' ? ` (${p.outcome.replace(/_/g, ' ')})` : '';
    return `Checked in ${text(p, 'assetName', 'an asset')} from ${text(p, 'holderName', 'its holder')}${outcome}`;
  },
  'asset.attachment_added': (p) =>
    `Attached ${text(p, 'filename', 'a file')} to ${text(p, 'assetName', 'an asset')}`,
  'asset.attachment_removed': (p) =>
    `Removed ${text(p, 'filename', 'a file')} from ${text(p, 'assetName', 'an asset')}`,
  'employee.created': (p) => `Added ${text(p, 'employeeName', 'an employee')}`,
  'employee.updated': (p) => `Updated ${text(p, 'employeeName', 'an employee')}${fieldList(p)}`,
  'employee.offboarding_started': (p) => {
    const scheduled = typeof p.scheduledReturns === 'number' ? p.scheduledReturns : 0;
    const suffix =
      scheduled > 0 ? ` · ${scheduled} ${scheduled === 1 ? 'return' : 'returns'} scheduled` : '';
    return `Started offboarding ${text(p, 'employeeName', 'an employee')}${suffix}`;
  },
  'employee.deleted': (p) => `Removed ${text(p, 'employeeName', 'an employee')}`,
  'custom_field.created': (p) => `Added the custom field ${text(p, 'label', 'a field')}`,
  'custom_field.updated': (p) => `Renamed a custom field to ${text(p, 'label', 'a field')}`,
  'custom_field.deleted': (p) => `Deleted the custom field ${text(p, 'label', 'a field')}`,
  'workflow.status_created': (p) => `Added the asset status ${text(p, 'label', 'a status')}`,
  'workflow.status_updated': (p) =>
    `Updated the asset status ${text(p, 'label', 'a status')}${fieldList(p)}`,
  'workflow.status_deleted': (p) => {
    const deleted = `Deleted the asset status ${text(p, 'label', 'a status')}`;
    // A status nothing carried is deleted outright; one that assets carried
    // took them somewhere, and the count is the part worth reading later.
    if (typeof p.migratedToLabel !== 'string') return deleted;
    const count = typeof p.assetCount === 'number' ? p.assetCount : 0;
    return `${deleted} · ${count} ${count === 1 ? 'asset' : 'assets'} moved to ${p.migratedToLabel}`;
  },
  'workflow.transitions_updated': (p) => {
    const added = typeof p.added === 'number' ? p.added : 0;
    const removed = typeof p.removed === 'number' ? p.removed : 0;
    // An event with no numbers still has to render — the sentence just stops
    // short of counting, rather than reading "0 transitions added".
    if (added === 0 && removed === 0) return 'Changed the workflow transitions';
    const word = added === 1 ? 'transition' : 'transitions';
    return `Changed the workflow (${added} ${word} added, ${removed} removed)`;
  },
  'workflow.statuses_reordered': () => 'Reordered the asset statuses',
  'member.invited': (p) => {
    const named = typeof p.role === 'string';
    // "an Admin" but "a Manager" — derived from the label so renaming a role
    // in enums.ts cannot leave the article behind saying the wrong thing.
    const what = named
      ? `${/^[aeiou]/i.test(role(p, 'role')) ? 'an' : 'a'} ${role(p, 'role')}`
      : 'a member';
    return `Invited ${text(p, 'email', 'somebody')} as ${what}`;
  },
  'member.joined': (p) => `${text(p, 'memberName', 'A member')} joined the workspace`,
  'member.role_changed': (p) =>
    `Changed ${text(p, 'memberName', 'a member')} from ${role(p, 'from')} to ${role(p, 'to')}`,
  'member.link_changed': (p) =>
    typeof p.employeeName === 'string'
      ? `Linked ${text(p, 'memberName', 'a member')} to the employee record for ${p.employeeName}`
      : `Unlinked ${text(p, 'memberName', 'a member')} from their employee record`,
  'member.invite_resent': (p) => `Resent the invitation to ${text(p, 'email', 'a member')}`,
  'member.reset_issued': (p) =>
    `Issued a password reset link for ${text(p, 'memberName', 'a member')}`,
  'member.removed': (p) => `Removed ${text(p, 'memberName', 'a member')} from the workspace`,
  'member.mfa_enrolled': (p) =>
    `${text(p, 'memberName', 'A member')} set up two-factor authentication`,
  'member.mfa_reset': (p) =>
    `Reset two-factor authentication for ${text(p, 'memberName', 'a member')}`,
  'auth.login': () => 'Signed in',
  'auth.password_reset': () => 'Reset their password',
  'system.setup_completed': (p) => `Set up ${text(p, 'orgName', 'the workspace')}`,
  'system.settings_updated': (p) => `Updated workspace settings${fieldList(p)}`,
};

/** Every action the API writes today. The test asserts each one renders. */
export const AUDIT_ACTIONS = Object.keys(RENDERERS);

/**
 * A sentence for one event. Unknown actions fall back to the raw action name
 * rather than an empty line — a log that hides events is worse than an ugly one.
 */
export function renderAuditEvent(event: RenderableAuditEvent): string {
  return RENDERERS[event.action]?.(event.params ?? {}) ?? event.action;
}

/** Which filter pill an action belongs under in the activity log. */
export function auditTypeForAction(action: string): AuditType {
  if (action.startsWith('asset.')) return 'assets';
  if (action.startsWith('employee.')) return 'people';
  if (action.startsWith('auth.') || action.startsWith('member.')) return 'auth';
  return 'system';
}
