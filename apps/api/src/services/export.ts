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

export function workspaceExport(db: Db, now: Date): WorkspaceExport {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    settings: getSettings(db),
    // Members without their password hashes: the file says who had access, and
    // gives nobody a way to use it.
    members: db
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
    employees: db.select().from(employees).all(),
    assets: db.select().from(assets).all(),
    assignments: db.select().from(assignments).all(),
    customFieldDefs: db.select().from(customFieldDefs).all(),
    assetCustomValues: db.select().from(assetCustomValues).all(),
    // Metadata only — the bytes live in DATA_DIR/uploads, which is what a real
    // backup copies.
    attachments: db
      .select({
        id: attachments.id,
        assetId: attachments.assetId,
        filename: attachments.filename,
        sizeBytes: attachments.sizeBytes,
        mime: attachments.mime,
        uploadedByMemberId: attachments.uploadedByMemberId,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .all(),
    auditEvents: db.select().from(auditEvents).all(),
  };
}
