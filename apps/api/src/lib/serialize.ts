import type { assets, employees } from '@/db/schema.js';
import type { AssignmentRow } from '@/services/assignments.js';
import type { MemberRow } from '@/plugins/session.js';

/** Who a mutation is attributed to in the audit log. */
export type Actor = { id: string; displayName: string };

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
    widgets: JSON.parse(member.widgetsJson || '{}') as Record<string, boolean>,
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
