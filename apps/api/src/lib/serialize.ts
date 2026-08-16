import type { MemberRow } from '../plugins/session.js';

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
