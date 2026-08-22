import type { Db } from '@/types/db.js';
import type { WorkspaceExport } from '@/types/export.js';
import {
  assetCustomValues,
  assets,
  assignments,
  attachments,
  auditEvents,
  customFieldDefs,
  employees,
  members,
  rolePermissions,
  roles,
} from '@/db/schema.js';
import { getSettings } from './settings.js';

/**
 * Everything the workspace holds, as one JSON file.
 *
 * **A reporting format, not a backup.** Restoring means replacing the `/data`
 * directory — this file has no session or token rows, no password hashes and no
 * attachment bytes, so nothing could sign in from it. It exists so a team can
 * take their inventory elsewhere, or read it with something other than this app.
 */
export const EXPORT_FORMAT_VERSION = 1;

export async function workspaceExport(db: Db, now: Date): Promise<WorkspaceExport> {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    settings: await getSettings(db),
    // Members without their password hashes: the file says who had access, and
    // gives nobody a way to use it.
    members: await db
      .select({
        id: members.id,
        email: members.email,
        displayName: members.displayName,
        role: members.role,
        status: members.status,
        employeeId: members.employeeId,
        lastActiveAt: members.lastActiveAt,
        createdAt: members.createdAt,
      })
      .from(members)
      .all(),
    // The roles those `role` ids name, and what each one allowed — the system
    // role has no grant rows, because its set is resolved rather than stored.
    roles: await db.select().from(roles).orderBy(roles.sortOrder).all(),
    rolePermissions: await db.select().from(rolePermissions).all(),
    employees: await db.select().from(employees).all(),
    assets: await db.select().from(assets).all(),
    assignments: await db.select().from(assignments).all(),
    customFieldDefs: await db.select().from(customFieldDefs).all(),
    assetCustomValues: await db.select().from(assetCustomValues).all(),
    // Metadata only — the bytes live in DATA_DIR/uploads, which is what a real
    // backup copies. The checksum is what lets the two be checked against each
    // other after a restore; it is null for files older than the column.
    attachments: await db
      .select({
        id: attachments.id,
        assetId: attachments.assetId,
        filename: attachments.filename,
        sizeBytes: attachments.sizeBytes,
        sha256: attachments.sha256,
        mime: attachments.mime,
        uploadedByMemberId: attachments.uploadedByMemberId,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .all(),
    auditEvents: await db.select().from(auditEvents).all(),
  };
}
