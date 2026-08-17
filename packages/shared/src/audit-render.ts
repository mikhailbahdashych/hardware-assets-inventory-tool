import { ASSET_STATUS_LABELS, type AssetStatus, type AuditType } from './enums.js';
import type { AuditParams, RenderableAuditEvent } from './types/audit.js';

// Audit events are stored structured — an action plus params with name
// snapshots — and rendered to sentences here. One renderer serves the per-asset
// trail, the activity log and the CSV export, so they can never drift apart.

const text = (params: AuditParams, key: string, fallback: string): string => {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
};

const status = (params: AuditParams, key: string): string => {
  const value = params[key];
  // Same rule as the unknown-action fallback below: a status slug this build
  // has no label for still renders as itself rather than vanishing.
  return typeof value === 'string'
    ? (ASSET_STATUS_LABELS[value as AssetStatus] ?? value)
    : 'unknown';
};

/** Field names as the forms say them, so a log line reads like the UI. */
const FIELD_LABELS: Record<string, string> = {
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
  'member.joined': (p) => `${text(p, 'memberName', 'A member')} joined the workspace`,
  'auth.login': () => 'Signed in',
  'system.setup_completed': (p) => `Set up ${text(p, 'orgName', 'the workspace')}`,
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
