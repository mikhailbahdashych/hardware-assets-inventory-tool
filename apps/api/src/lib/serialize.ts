import type { MemberStatus, Role } from '@inventory/shared';
import type { assets, employees } from '@/db/schema.js';
import type { AssignmentRow } from '@/types/assignments.js';
import type { MemberRow, MemberSummary } from '@/types/members.js';

export function serializeMember(member: MemberRow) {
  return {
    id: member.id,
    email: member.email,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    employeeId: member.employeeId,
    lastActiveAt: member.lastActiveAt,
    theme: member.theme,
    density: member.density,
    // widgets_json is NOT NULL DEFAULT '{}' and only ever written by
    // JSON.stringify in /me/prefs, so it always parses. If it ever does not,
    // the row is corrupt and the throw is the bug report.
    widgets: JSON.parse(member.widgetsJson) as Record<string, boolean>,
  };
}

/**
 * A member as everyone else sees them on the Members page — never their theme,
 * density or widget layout, which belong to `serializeMember` above and to the
 * person themselves. The linked employee is named here so the list needs no
 * second request to render its "Linked employee" column.
 */
export function serializeMemberSummary(
  member: MemberRow,
  linked: typeof employees.$inferSelect | null,
): MemberSummary {
  return {
    id: member.id,
    email: member.email,
    displayName: member.displayName,
    // Enum columns are TEXT with no CHECK constraint on purpose (adding a role
    // is a code-only change); the zod schema on every write is what holds them
    // to the slugs these types name.
    role: member.role as Role,
    status: member.status as MemberStatus,
    employeeId: member.employeeId,
    linkedEmployee: linked
      ? { id: linked.id, displayName: `${linked.firstName} ${linked.lastName}` }
      : null,
    lastActiveAt: member.lastActiveAt,
    createdAt: member.createdAt,
  };
}

/**
 * Assets carry their current holder, read from the open ownership record —
 * there is no denormalized holder column, so this is never stale.
 */
export function serializeAsset(asset: typeof assets.$inferSelect, holder: AssignmentRow | null) {
  return {
    ...asset,
    currentHolder: holder
      ? {
          employeeId: holder.employeeId,
          name: holder.holderNameSnapshot,
          checkedOutAt: holder.checkedOutAt,
          expectedReturnDate: holder.expectedReturnDate,
        }
      : null,
  };
}

/** One ownership record, as the timeline and the employee pages read it. */
export function serializeAssignment(assignment: AssignmentRow) {
  return {
    id: assignment.id,
    employeeId: assignment.employeeId,
    holderName: assignment.holderNameSnapshot,
    checkedOutAt: assignment.checkedOutAt,
    expectedReturnDate: assignment.expectedReturnDate,
    returnedAt: assignment.returnedAt,
    outcome: assignment.outcome,
    checkoutNotes: assignment.checkoutNotes,
    checkinCondition: assignment.checkinCondition,
    checkinNotes: assignment.checkinNotes,
  };
}

/** An ownership record seen from the person's side, so it names the asset. */
export function serializeHolding(assignment: AssignmentRow, asset: typeof assets.$inferSelect) {
  return {
    ...serializeAssignment(assignment),
    assetId: asset.id,
    assetName: asset.name,
    assetTag: asset.assetTag,
    category: asset.category,
    serialNumber: asset.serialNumber,
  };
}

export function serializeEmployee(
  employee: typeof employees.$inferSelect,
  activeAssetCount: number,
) {
  return {
    ...employee,
    displayName: `${employee.firstName} ${employee.lastName}`,
    activeAssetCount,
  };
}
